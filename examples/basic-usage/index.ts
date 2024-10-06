import { DefaultServer } from 'dinodns/dist/common/server';
import { DNSOverTCP } from 'dinodns';
import { RedisStore } from '../../src';

const store = new RedisStore({
  host: 'localhost',
  port: 6379,
  db: 0,
});

store.set('*.example.com', 'A', {
  name: '*', // this does not really matter since the name will be replaced by the matching query
  type: 'A',
  ttl: 300,
  data: '127.0.0.1',
});

const server = new DefaultServer({
  networks: [new DNSOverTCP('localhost', 1054)],
});

server.use(store.handler);

server.start(() => {
  console.log('Server started');
});
