import { Store } from 'dinodns/plugins/storage';
import { SupportedAnswer, Handler, SupportedRecordType, ZoneData, ZoneDataMap } from 'dinodns/types';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { RecordType } from 'dns-packet';
import { isEqual as _isEqual } from 'lodash';
import { EventEmitter } from 'events';

export type RedisStoreOptions = {
  /** An optional redis client */
  client?: Redis;

  /** Whether the store should emit cache requests. Defaults to true. */
  shouldCache?: boolean;
} & RedisOptions;

export class RedisStore extends EventEmitter implements Store {
  private client: Redis;
  private shouldCache = true;

  constructor(options: RedisStoreOptions) {
    super();

    if (!options) {
      throw new Error('RedisStore requires options');
    }

    if (options.shouldCache) {
      this.shouldCache = options.shouldCache;
    }

    if (options.client) {
      this.client = options.client;

      return;
    }

    this.client = new Redis(options);
  }

  async get<T extends SupportedRecordType>(
    name: string,
    rType?: T,
    wildcards = true,
  ): Promise<Partial<ZoneDataMap> | null> {
    let key = this.nameToKey(name);
    // first attempt to get the data from the exact match
    if (rType) {
      const data = await this.client.hget(key, rType);
      if (data) {
        return {
          [rType]: JSON.parse(data),
        };
      }
    } else {
      // if no type is provided, get all the data
      const data = await this.client.hgetall(key);

      if (data && Object.keys(data).length > 0) {
        return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(v)]));
      }
    }

    // if wildcards are enabled, try to get the data from the wildcard
    if (!wildcards) {
      return null;
    }

    while (key !== '') {
      key = key
        .split(':') // already reverse sorted, split by colon
        .toSpliced(-1, 1) // remove the least specific domain part
        .join(':'); // rejoin the parts

      const wildcardKey = key + ':*';

      if (rType) {
        const data = await this.client.hget(wildcardKey, rType);
        if (data) {
          return {
            [rType]: JSON.parse(data),
          };
        }
      } else {
        const data = await this.client.hgetall(wildcardKey);
        if (data && Object.keys(data).length > 0) {
          return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(v)]));
        }
      }
    }

    // last check for the root wildcard
    if (wildcards) {
      const wildcardKey = '*';
      if (rType) {
        const data = await this.client.hget(wildcardKey, rType);
        if (data) {
          return JSON.parse(data);
        }
      } else {
        const data = await this.client.hgetall(wildcardKey);
        if (data && Object.keys(data).length > 0) {
          return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(v)]));
        }
      }
    }

    return null;
  }

  /**
   * Resolve a queried domain name to the raw or wildcard domain name
   * stored in the database.
   * @param name
   */
  async resolve(name: string): Promise<string | null> {
    let key = this.nameToKey(name);
    const data = await this.client.hgetall(key);
    if (data && Object.keys(data).length > 0) {
      return key;
    }

    while (key !== '') {
      key = key
        .split(':') // already reverse sorted, split by colon
        .toSpliced(-1, 1) // remove the least specific domain part
        .join(':'); // rejoin the parts

      const wildcardKey = key + ':*';
      const data = await this.client.hgetall(wildcardKey);
      if (data && Object.keys(data).length > 0) {
        return wildcardKey.split(':').toReversed().join('.');
      }
    }

    return null;
  }

  /**
   * Stores data in the Redis store as a JSON array string. New data is appended to old data.
   * @param name The domain pattern to set. Accepts wildcards.
   * @param rType The data type
   * @param data The data to store
   * @returns
   */
  async set<T extends SupportedRecordType>(name: string, rType: T, data: ZoneData[T] | ZoneData[T][]): Promise<void> {
    const key = this.nameToKey(name);
    if (!Array.isArray(data)) {
      data = [data];
    }

    await this.client.hset(key, rType, JSON.stringify(data));
  }

  /**
   * Appends data to the Redis store as a JSON array string.
   * @param name
   * @param rType
   * @param data
   */
  async append<T extends SupportedRecordType>(name: string, rType: T, data: ZoneData[T]): Promise<void> {
    const key = this.nameToKey(name);
    const existingData = await this.client.hget(key, rType);
    if (existingData) {
      const parsedData = JSON.parse(existingData);
      const newData = [...parsedData, data];
      await this.client.hset(key, rType, JSON.stringify(newData));

      return;
    }

    await this.client.hset(key, rType, JSON.stringify([data]));
  }

  async delete<T extends SupportedRecordType>(name: string, rType?: T, rData?: ZoneData[T]): Promise<void> {
    const key = this.nameToKey(name);

    if (rType && rData) {
      const existingData = await this.client.hget(key, rType);
      if (existingData) {
        const parsedData = JSON.parse(existingData);
        const newData = parsedData.filter((d: ZoneData[T]) => !_isEqual(d, rData));
        if (newData.length === 0) {
          await this.client.hdel(key, rType);

          return;
        }

        await this.client.hset(key, rType, JSON.stringify(newData));

        return;
      }
    }

    if (rType) {
      await this.client.hdel(key, rType);

      return;
    }

    await this.client.del(key);

    return;
  }

  nameToKey(name: string): string {
    return name.split('.').toReversed().join(':');
  }

  handler: Handler = async (req, res, next) => {
    if (res.finished) {
      return next();
    }

    const { name, type } = req.packet.questions[0];
    const result = await this.get(name, type as Exclude<RecordType, 'OPT'>);
    if (result) {
      const answers: SupportedAnswer[] = Object.entries(result)
        .map(([key, value]) => {
          return value.map((data) => {
            return {
              name: name,
              type: key,
              ttl: 300,
              data,
            } as SupportedAnswer;
          });
        })
        .flat();

      res.answer(answers);

      if (this.shouldCache) {
        this.emitCacheRequest(
          name,
          type,
          answers.map((a) => a.data),
        );
      }
    }

    next();
  };

  async emitCacheRequest<T extends SupportedRecordType>(zone: string, rType: T, records: ZoneData[T][]) {
    this.emit('cacheRequest', {
      zoneName: zone,
      recordType: rType,
      records: records,
    });
  }
}
