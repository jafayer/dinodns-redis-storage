import { DNSOverTCP, DefaultServer } from 'dinodns/common';
import { RedisStore } from '../../src';

const store = new RedisStore({
  host: 'localhost',
  port: 6379,
  db: 0,
});

store.set('*.example.com', 'A', '127.0.0.2');
store.set('example.com', 'A', '127.0.0.1');

const server = new DefaultServer({
  networks: [new DNSOverTCP('localhost', 1054)],
});

server.use(store.handler);
server.use(store.handler);

server.start(() => {
  console.log('Server started');
});
