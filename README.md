# DinoDNS Redis Store

The `RedisStore` is a storage plugin for the [DinoDNS DNS framework](https://github.com/jafayer/dinodns).

It provides a simple API for storing and retrieving DNS records from a Redis database.

Records are stored in Redis using hash sets, with keys consisting of inverted, colon-joined domain names.

That is, the domain `example.com` would be stored as `com:example`. Record types are stored as keys
under the domain names.

Wildcard queries are supported. For more information, read the [get method](#get) documentation.

## Installation

`npm i @dinodns/redis-store`

## Usage in DinoDNS

Once you have the Redis store set up as desired, you can use it in the plugin chain by calling

```typescript
server.use(redisStore.handler.bind(redisStore));
```

Alternatively, if you're creating a DinoDNS server instance, you can simply set it in constructor

```typescript
new DinoDNS({
    storage: redisStore,
    ...
});
```

## API

### Constructor

```typescript
new RedisStore(client: Redis | RedisOptions);
```

or

```typescript
const store = new RedisStore({
  host: 'localhost',
  port: 6379,
  db: 0,
});
```

- client: an instance of [`ioredis`](https://github.com/redis/ioredis) client or a RedisOptions object.

### get

Retrieves DNS records from the Redis store

```typescript
await store.get(name: string, rType?: SupportedRecordType, wildcards?: boolean)
```

- `name`: The domain name to query for
- `rType`: The record type ('A', 'AAAA', etc.). Supports all record types DinoDNS supports.
- `wildcards`: Whether to enable wildcard matching. Defaults to `true`.

_Note: enabling wildcard matching may incur a small performance penalty but shouldn't be an issue in practice. Wildcard matching is achieved by iterating up each level of the domain hierarchy, so O(n) successive requests are sent for every label in the domain._

### set

Sets DNS records in the Redis store, overwriting anything that is there for the record type.

```typescript
await store.set(name: string, rType: SupportedRecordType, data: SupportedAnswer | SupportedAnswer[]);
```

- `name`: The domain name to set a record for.
- `rType`: The record type.
- `data`: The [dns-packet](https://github.com/mafintosh/dns-packet) Answer object.

### append

Appends DNS records to the existing records in the Redis store.

```typescript
await store.append(name: string, rType: SupportedRecordType, data: SupportedAnswer);
```

- `name`: The domain name to append records to.
- `rType`: The record type.
- `data`: The [dns-packet](https://github.com/mafintosh/dns-packet) Answer object.

### delete

Deletes DNS records from the Redis store. If an rType is not provided, the whole matching zone's records will be deleted. If an `Answer` object is not provided in the data argument, the entire record type will be deleted for that zone. Answers are matched using deep equality.

```typescript
await store.delete(name: string, rType?: SupportedRecordType, data?: SupportedAnswer);
```

- `name`: The domain name to delete records from.
- `rType`: The record type. Optional.
- `data`: The specific DNS record to delete. Optional.
