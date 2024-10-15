import { RedisStore } from '.';
import Redis from 'ioredis';
import { RecordType } from 'dns-packet';
import { SupportedAnswer } from 'dinodns';
import { ZoneData } from 'dinodns/types/dns';
import _ from 'lodash';

jest.mock('ioredis');

describe('RedisStore', () => {
  let store: RedisStore;
  let client: Redis;
  const ARecords: ZoneData['A'][] = ['127.0.0.1', '127.0.0.2'];

  const AAAARecords: ZoneData['AAAA'][] = ['::1', '::2'];

  const internalData = {
    A: JSON.stringify(ARecords),
    AAAA: JSON.stringify(AAAARecords),
  };

  beforeEach(() => {
    client = new Redis();
    store = new RedisStore({ client });
  });

  describe('create', () => {
    it('should be able to create a redis store with a passed in client', () => {
      const client = new Redis();
      const store = new RedisStore({ client });
      expect(store).toBeInstanceOf(RedisStore);
    });

    it('should be able to create a redis store with passed in options', () => {
      const options = {
        host: 'localhost',
        port: 6379,
        db: 0,
      };
      const store = new RedisStore(options);
      expect(store).toBeInstanceOf(RedisStore);
    });
  });

  describe('get', () => {
    it('should get data from the exact match', async () => {
      const name = 'example.com';
      const rType = 'A';
      const data = '127.0.0.1';

      client.hget = jest.fn(async (key, rType: 'A' | 'AAAA') => {
        if (key === 'com:example' && internalData[rType]) {
          return internalData[rType];
        }

        return null;
      });

      client.hgetall = jest.fn(async (key) => {
        if (key === 'com:example') {
          return internalData;
        }

        return {};
      });

      const result = await store.get(name, rType);
      expect(result).toEqual(ARecords);

      const result2 = await store.get(name);
      expect(result2).toEqual([...ARecords, ...AAAARecords]);

      const result3 = await store.get('example.com', 'AAAA');
      expect(result3).toEqual(AAAARecords);

      const result4 = await store.get('example.com', 'CNAME');
      expect(result4).toEqual(null);

      const result5 = await store.get('notinthere.com');
      expect(result5).toEqual(null);
    });

    it('should not return data if wildcards are disabled', async () => {
      const name = 'example.com';
      const rType = 'A';
      const data = '127.0.0.1';

      client.hget = jest.fn(async (key, rType: 'A' | 'AAAA') => {
        if (key === 'com:example' && internalData[rType]) {
          return internalData[rType];
        }

        if (key === 'com:*') {
          return internalData[rType];
        }

        return null;
      });

      client.hgetall = jest.fn(async (key) => {
        if (key === 'com:example') {
          return internalData;
        }

        if (key === 'com:*') {
          return internalData;
        }

        return {};
      });

      const result = await store.get('test.com', rType, false);
      expect(result).toEqual(null);

      const result2 = await store.get('test.com', undefined, false);
      expect(result2).toEqual(null);
    });

    it('should get data from the wildcard', async () => {
      const name = 'example.com';
      const rType = 'A';
      const data = '127.0.0.1';

      client.hget = jest.fn(async (key, rType: 'A' | 'AAAA') => {
        if (key === 'com:example' && internalData[rType]) {
          return internalData[rType];
        }

        if (key === 'com:*') {
          return internalData[rType];
        }

        return null;
      });

      client.hgetall = jest.fn(async (key) => {
        if (key === 'com:example') {
          return internalData;
        }

        if (key === 'com:*') {
          return internalData;
        }

        return {};
      });

      const result = await store.get(name, rType);
      expect(result).toEqual(ARecords);

      const result2 = await store.get(name);
      expect(result2).toEqual([...ARecords, ...AAAARecords]);

      const result3 = await store.get('test.com', 'AAAA');
      expect(result3).toEqual(AAAARecords);

      const result4 = await store.get('test.com');
      expect(result4).toEqual([...ARecords, ...AAAARecords]);

      const result5 = await store.get('notinthere.net');
      expect(result5).toEqual(null);
    });
  });

  describe('set', () => {
    let internalData: Record<string, Partial<Record<RecordType, string>>>;

    beforeEach(() => {
      internalData = {};
      // @ts-ignore
      client.hset = jest.fn(async (key: string, rType: RecordType, data: string) => {
        internalData[key] = { ...internalData[key], [rType]: data };
      });

      client.hget = jest.fn(async (key: string, rType: 'A' | 'AAAA'): Promise<string | null> => {
        const data = internalData[key];
        if (data && data[rType]) {
          return data[rType]!;
        }

        return null;
      });
    });

    it('should be able to set a single record', async () => {
      const name = 'example.com';
      const rType = 'A';
      const data = ARecords[0];

      await store.set(name, rType, data);

      expect(_.isEqual(internalData['com:example'], { A: JSON.stringify([data]) })).toBe(true);
      const result = await store.get(name, rType);
      expect(result).toEqual([data]);
    });

    it('should be able to set an array of records', async () => {
      const name = 'example.com';

      await store.set(name, 'A', ARecords);

      expect(_.isEqual(internalData['com:example'], { A: JSON.stringify(ARecords) })).toBe(true);
      const result = await store.get(name, 'A');
      expect(result).toEqual(ARecords);
    });
  });

  describe('append', () => {
    let internalData: Record<string, Partial<Record<RecordType, string>>>;
    beforeEach(() => {
      internalData = {};
      // @ts-ignore
      client.hset = jest.fn(async (key: string, rType: RecordType, data: string) => {
        internalData[key] = { ...internalData[key], [rType]: data };
      });

      client.hget = jest.fn(async (key: string, rType: 'A' | 'AAAA'): Promise<string | null> => {
        const data = internalData[key];
        if (data && data[rType]) {
          return data[rType]!;
        }

        return null;
      });
    });

    it('should be able to append data when no data exists', async () => {
      const name = 'example.com';
      await store.append(name, 'A', ARecords[0]);
      expect(JSON.stringify(internalData['com:example'])).toEqual(JSON.stringify({ A: JSON.stringify([ARecords[0]]) }));
      const result = await store.get(name, 'A');
      expect(result).toEqual([ARecords[0]]);
    });

    it('should be able to append data when data exists', async () => {
      const name = 'example.com';
      await store.set(name, 'A', ARecords[0]);
      await store.append(name, 'A', ARecords[1]);
      expect(JSON.stringify(internalData['com:example'])).toEqual(JSON.stringify({ A: JSON.stringify(ARecords) }));
      const result = await store.get(name, 'A');
      expect(result).toEqual(ARecords);
    });
  });

  describe('delete', () => {
    let internalData: Record<string, Partial<Record<RecordType, string>>>;
    beforeEach(() => {
      internalData = {};
      // @ts-ignore
      client.hset = jest.fn(async (key: string, rType: RecordType, data: string) => {
        internalData[key] = { ...internalData[key], [rType]: data };
      });

      client.hget = jest.fn(async (key: string, rType: 'A' | 'AAAA'): Promise<string | null> => {
        const data = internalData[key];
        if (data && data[rType]) {
          return data[rType]!;
        }

        return null;
      });

      // @ts-ignore
      client.hdel = jest.fn(async (key: string) => {
        delete internalData[key];
      });

      // @ts-ignore
      client.del = jest.fn(async (key: string) => {
        delete internalData[key];
      });
    });

    it('should be able to delete all data from the correct key', async () => {
      const name = 'example.com';
      await store.set(name, 'A', ARecords);
      await store.delete(name);
      const result = await store.get(name, 'A');
      expect(result).toEqual(null);
    });

    it('should be able to delete a whole record type from the correct key', async () => {
      const name = 'example.com';
      await store.set(name, 'A', ARecords);
      await store.delete(name, 'A');
      const result = await store.get(name, 'A');
      expect(result).toEqual(null);
    });

    it('should be able to delete a specific record from the correct key', async () => {
      const name = 'example.com';
      await store.set(name, 'A', ARecords);
      await store.delete(name, 'A', ARecords[0]);
      const result = await store.get(name, 'A');
      expect(result).toEqual([ARecords[1]]);
    });

    it('should be able to delete a specific record when no records exist', async () => {
      const name = 'example.com';
      await store.delete(name, 'A', ARecords[0]);
      const result = await store.get(name, 'A');
      expect(result).toEqual(null);
    });

    it('should clean up the key if no records are left', async () => {
      const name = 'example.com';
      await store.set(name, 'A', ARecords);
      await store.delete(name, 'A', ARecords[0]);
      const result1 = await store.get(name, 'A');
      expect(result1).toEqual([ARecords[1]]);
      await store.delete(name, 'A', ARecords[1]);
      const result2 = await store.get(name, 'A');
      expect(result2).toEqual(null);
    });
  });

  describe('name to key conversion', () => {
    it('should be able to convert a name to a key', () => {
      const name = 'example.com';
      const key = store.nameToKey(name);
      expect(key).toEqual('com:example');
    });

    it('should be able to convert a wildcard name to a key with only one label', () => {
      const name = 'com';
      const key = store.nameToKey(name);
      expect(key).toEqual('com');
    });

    it('should be able to convert a wildcard name to an associated key', () => {
      const name = '*.example.com';
      const key = store.nameToKey(name);
      expect(key).toEqual('com:example:*');
    });
  });
});
