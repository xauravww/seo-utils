import Redis from 'ioredis';

// Single-node Redis test (existing code)
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
});

(async () => {
  try {
    await redis.set('test', 'hello from Node.js');
    const value = await redis.get('test');
    console.log('Redis value (single-node):', value);
    await redis.quit();
  } catch (err) {
    console.error('Redis error (single-node):', err);
  }
})();

// Redis Cluster test with natMap (for Docker environments)
const cluster = new Redis.Cluster([
  {
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT) || 6379,
  }
], {
  natMap: {
    // Map internal Docker hostname to external (if needed)
    'redis:6379': { host: 'localhost', port: 6379 },
    // Add more mappings as needed
  }
});

(async () => {
  try {
    await cluster.set('test-cluster', 'hello from Redis Cluster');
    const value = await cluster.get('test-cluster');
    console.log('Redis value (cluster):', value);
    await cluster.quit();
  } catch (err) {
    console.error('Redis error (cluster):', err);
  }
})();
