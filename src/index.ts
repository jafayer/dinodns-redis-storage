import type { Store, SupportedAnswer, Handler } from 'dinodns';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { Answer, RecordType } from 'dns-packet';
import { isEqual as _isEqual } from 'lodash';

export class RedisStore implements Store {
  private client: Redis;

  constructor(redisClient: Redis);
  constructor(redisOptions: RedisOptions);
  constructor(options: RedisOptions | Redis) {
    if (options instanceof Redis) {
      this.client = options;

      return;
    }

    this.client = new Redis(options);
  }

  async get(name: string, rType?: Exclude<RecordType, 'OPT'>, wildcards = true): Promise<Answer | Answer[] | null> {
    let key = this.nameToKey(name);
    // first attempt to get the data from the exact match
    if (rType) {
      const data = await this.client.hget(key, rType);
      if (data) {
        return JSON.parse(data);
      }
    } else {
      const data = await this.client.hgetall(key);
      if (data && Object.keys(data).length > 0) {
        return Object.values(data)
          .map((d) => JSON.parse(d))
          .flat();
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
          return JSON.parse(data).map((d: Answer) => ({ ...d, name }));
        }
      } else {
        const data = await this.client.hgetall(wildcardKey);
        if (data && Object.keys(data).length > 0) {
          return Object.values(data)
            .map((d) => JSON.parse(d))
            .flat()
            .map((d: Answer) => ({ ...d, name }));
        }
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
  async set(name: string, rType: Exclude<RecordType, 'OPT'>, data: SupportedAnswer | SupportedAnswer[]): Promise<void> {
    const key = this.nameToKey(name);
    if (Array.isArray(data)) {
      await this.client.hset(key, rType, JSON.stringify(data));

      return;
    }

    await this.client.hset(key, rType, JSON.stringify([data]));
  }

  /**
   * Appends data to the Redis store as a JSON array string.
   * @param name
   * @param rType
   * @param data
   */
  async append(name: string, rType: Exclude<RecordType, 'OPT'>, data: SupportedAnswer): Promise<void> {
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

  async delete(name: string, rType?: Exclude<RecordType, 'OPT'>, rData?: SupportedAnswer): Promise<void> {
    const key = this.nameToKey(name);

    if (rType && rData) {
      const existingData = await this.client.hget(key, rType);
      if (existingData) {
        const parsedData = JSON.parse(existingData);
        const newData = parsedData.filter((d: Answer) => !_isEqual(d, rData));
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

    await this.client.hdel(key);

    return;
  }

  nameToKey(name: string): string {
    return name.split('.').toReversed().join(':');
  }

  handler: Handler = async (req, res, next) => {
    const { name, type } = req.packet.questions[0];
    const result = await this.get(name, type as Exclude<RecordType, 'OPT'>);
    if (result) {
      // @ts-ignore
      res.answer(result);
    }

    next();
  };
}
