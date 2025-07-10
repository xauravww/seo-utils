import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

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