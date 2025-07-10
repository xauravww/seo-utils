import dotenv from 'dotenv';
dotenv.config();
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

console.log('[flush-queues.js] REDIS_HOST:', process.env.REDIS_HOST);
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
  console.error('[flush-queues.js][REDIS ERROR]', err);
});

const categories = [
  'blog', 'article', 'forum', 'social_media', 'search', 'ping',
  'classified', 'bookmarking', 'directory', 'other'
];

const flush = async () => {
  for (const cat of categories) {
    const queue = new Queue(`${cat}Queue`, { connection });
    const activeJobs = await queue.getJobs(['active']);
    let allRemoved = true;
    for (const job of activeJobs) {
      try {
        await job.remove();
        console.log(`Removed active job ${job.id} from ${cat}Queue`);
      } catch (err) {
        allRemoved = false;
        console.error(`Failed to remove job ${job.id} from ${cat}Queue: ${err.message}`);
      }
    }
    if (!allRemoved && activeJobs.length > 0) {
      // Try to obliterate the queue if any active jobs couldn't be removed
      try {
        await queue.pause();
        await queue.obliterate({ force: true });
        console.log(`Obliterated all jobs in ${cat}Queue (including active jobs)`);
      } catch (obliterateErr) {
        console.error(`Failed to obliterate ${cat}Queue: ${obliterateErr.message}`);
      }
    }
  }
  await connection.quit();
};

flush();