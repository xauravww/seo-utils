import Redis from 'ioredis';

// change host if needed (e.g. '127.0.0.1' for local, 'redis' inside docker)
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
});

(async () => {
  try {
    await redis.set('test', 'hello from Node.js');
    const value = await redis.get('test');
    console.log('Redis value:', value);
    await redis.quit();
  } catch (err) {
    console.error('Redis error:', err);
  }
})();
