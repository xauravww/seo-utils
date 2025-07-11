import dotenv from 'dotenv';
dotenv.config();
console.log('Cloudinary ENV:', process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET);
import { Worker as BullWorker, QueueEvents } from 'bullmq';
import { createClient } from 'redis';
import { parentPort, workerData } from 'worker_threads';
import * as websocketLogger from './websocketLogger.js';
import { getAdapter } from './controllerAdapters.js';
import { queues, categories, processPublishJob, redisConnectionConfig } from './controllers/publishController.js';

// TODO: Import the controller adapters
// import { getAdapter } from './controllerAdapters.js';

// Utility function to map granular categories to parent categories for logging
const getParentCategory = (granularCategory) => {
    if (!granularCategory) {
        return 'uncategorized';
    }
    // Normalize to lower case for consistent matching
    const lowerCaseCategory = granularCategory.toLowerCase();

    if (lowerCaseCategory.includes('blog') || lowerCaseCategory.includes('wppostcontroller')) {
        return 'blog';
    }
    if (lowerCaseCategory.includes('article')) {
        return 'article';
    }
    if (lowerCaseCategory.includes('search') || lowerCaseCategory.includes('secretsearchenginelabs') || lowerCaseCategory.includes('activesearchresults')) {
        return 'search';
    }
    if (lowerCaseCategory.includes('ping') || lowerCaseCategory.includes('pingmylinks')) {
        return 'ping';
    }
    if (lowerCaseCategory.includes('classified')) {
        return 'classified';
    }
    if (lowerCaseCategory.includes('forum')) {
        return 'forum';
    }
    if (lowerCaseCategory.includes('bookmarking') || lowerCaseCategory.includes('bookmarkzoo') || lowerCaseCategory.includes('teslabookmarks') || lowerCaseCategory.includes('pearlbookmarking') || lowerCaseCategory.includes('ubookmarking')) {
        return 'bookmarking';
    }
    if (lowerCaseCategory.includes('directory') || lowerCaseCategory.includes('gainweb') || lowerCaseCategory.includes('socialsubmissionengine')) {
        return 'directory';
    }
    if (lowerCaseCategory.includes('social_media') || lowerCaseCategory.includes('redditcontroller') || lowerCaseCategory.includes('twittercontroller') || lowerCaseCategory.includes('facebookcontroller') || lowerCaseCategory.includes('instagramcontroller')) {
        return 'social_media';
    }

    // Default to 'other' or the original granular category if no specific mapping
    return 'other'; // Or consider returning granularCategory for unmapped types
};

const processWebsite = async (jobDetails, job) => {
    const { requestId, website, content, campaignId } = jobDetails;
    const { url, category } = website;
    console.log(`[${requestId}] [Worker] Starting job for ${url}`);

    publishLog(requestId, `[Worker] Starting job for ${url}`, 'info');

    // 1. Get the correct adapter for the website
    console.log(`[${requestId}] [Worker] Getting adapter for category: '${category}', url: ${url}`);
    const adapter = getAdapter({ ...jobDetails, job });
    
    let adapterLogs = []; // Initialize an array to hold logs from this adapter
    // 2. If adapter exists, run it
    if (adapter) {
        console.log(`[${requestId}] [Worker] Adapter found, executing publish for ${url}.`);
        const publishResult = await adapter.publish(job); // Pass job to publish()
        adapterLogs = adapter.getCollectedLogs(); // Get logs collected by this adapter
        if (publishResult.success) {
            console.log(`[${requestId}] [Worker] Adapter publish completed for ${url}.`);
            if (publishResult.postUrl) {
                console.log(`[${requestId}] [Worker] Posted URL: ${publishResult.postUrl}`);
            } else if (publishResult.tweetUrl) {
                console.log(`[${requestId}] [Worker] Posted URL: ${publishResult.tweetUrl}`);
            }
        } else {
            console.error(`[${requestId}] [Worker] Adapter publish failed for ${url}: ${publishResult.error}`);
        }
        // After result is created (success or failure)
        const result = { ...publishResult, category, adapterLogs };
        // Always push at least one log to Redis for aggregation
        if (jobDetails.campaignId) {
            const logsToPush = (result.adapterLogs && result.adapterLogs.length > 0)
              ? result.adapterLogs
              : [{ message: 'No logs collected by adapter.', level: 'info' }];
            await connection.rpush(
              `campaign_logs:${jobDetails.campaignId}`,
              JSON.stringify({
                userId: jobDetails.userId,
                website: jobDetails.website.url,
                logs: {
                  [result.category]: {
                    logs: logsToPush,
                    result: result.success ? 'success' : 'failure',
                  }
                }
              })
            );
        }
        return result;
    } else {
        const message = `[Worker] No adapter found for category: '${category}' or domain: ${url}`;
        console.warn(`[${requestId}] ${message}`);
        publishLog(requestId, message, 'warning');
        // Push logs to Redis for aggregation, regardless of success
        if (jobDetails.campaignId) {
            await connection.rpush(
              `campaign_logs:${jobDetails.campaignId}`,
              JSON.stringify({
                userId: jobDetails.userId,
                website: jobDetails.website.url,
                logs: {
                  'uncategorized': {
                    logs: [{ message, level: 'warning' }],
                    result: 'failure',
                  }
                }
              })
            );
        }
        return { success: false, error: message, category, adapterLogs: [{ message, level: 'warning' }] }; // Return failure if no adapter
    }
};

const run = async (workerData) => {
    const { requestId, websites, content, campaignId, minimumInclude } = workerData;
    console.log(`[${requestId}] [Worker] Background worker starting. Processing ${websites.length} websites.`);

    publishLog(requestId, `[Worker] Background worker started. Processing ${websites.length} websites.`, 'info');

    let allSuccess = true; // Track overall success
    const results = []; // Array to store results from each adapter
    const categorizedLogs = {}; // Object to store logs categorized by website category

    // --- NEW LOGIC: Only count successful publications, skip failed, and continue until minimumInclude is satisfied ---
    let successCount = 0;
    let triedIndexes = new Set();
    let i = 0;
    const maxTries = websites.length;
    const requiredCount = minimumInclude || maxTries;
    while (successCount < requiredCount && triedIndexes.size < maxTries) {
        // Find the next untried website
        while (i < websites.length && triedIndexes.has(i)) i++;
        if (i >= websites.length) break;
        triedIndexes.add(i);
        const website = websites[i];
        const result = await processWebsite({ requestId, website, content, campaignId }, null); // Pass null for job instance
        results.push(result);
        if (result && result.success) {
            successCount++;
        } else {
            allSuccess = false;
        }
        // Aggregate logs by parent category, and also track result count
        if (result.category && result.adapterLogs) {
            const parentCategory = getParentCategory(result.category);
            if (!categorizedLogs[parentCategory]) {
                categorizedLogs[parentCategory] = { logs: [], result: '' };
            }
            categorizedLogs[parentCategory].logs.push(...result.adapterLogs);
        }
        i = 0; // Always start from the beginning to find the next untried
    }
    // Add result string to each category
    for (const cat in categorizedLogs) {
        categorizedLogs[cat].result = `${successCount}/${requiredCount}`;
    }
    // --- END NEW LOGIC ---

    if (successCount > 0) {
        publishLog(requestId, `[Worker] Publications completed: ${successCount}/${requiredCount} for request ${requestId}.`, 'success');
        console.log(`[${requestId}] [Worker] Publications completed: ${successCount}/${requiredCount}.`);
        // Remove parentPort.postMessage and always return the result object for BullMQ
        return { status: 'done', results, categorizedLogs };
    } else {
        publishLog(requestId, `[Worker] No successful publications for request ${requestId}.`, 'error');
        console.error(`[${requestId}] [Worker] No successful publications.`);
        // Remove parentPort.postMessage and always return the error object for BullMQ
        return { status: 'error', message: 'No successful publication jobs.', categorizedLogs };
    }
};
console.log('[publishWorker.js] REDIS_HOST:', process.env.REDIS_HOST);
const connection = createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});
await connection.connect();
console.log('[publishWorker.js] REDIS_HOST:', process.env.REDIS_HOST);
const redisPublisher = createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});
await redisPublisher.connect();
function publishLog(requestId, message, level = 'info') {
  const payload = JSON.stringify({ message, level, timestamp: new Date().toISOString() });
  redisPublisher.publish(`logs:${requestId}`, payload);
}

connection.on('error', (err) => {
  console.error('[publishWorker.js][REDIS ERROR][connection]', err);
});
redisPublisher.on('error', (err) => {
  console.error('[publishWorker.js][REDIS ERROR][redisPublisher]', err);
});

// --- BullMQ Worker Setup ---
const queueConcurrency = parseInt(process.env.QUEUE_CONCURRENCY, 10) || 1;

const startAllCategoryWorkers = () => {
  console.log('[BullMQ] Categories for worker startup:', categories);
  categories.forEach(category => {
    new BullWorker(
      `${category}Queue`,
      async (job) => {
        console.log(`[BullMQ] [${category}] Picked up job ${job.id} from ${category}Queue`);
        await job.log(`[BullMQ] [${category}] Picked up job ${job.id} from ${category}Queue`);
        // Support both old (reqBody) and new (per-website) job formats
        let jobData;
        let requestId;
        if (job.data.reqBody) {
          // Old format: single job with reqBody
          const { reqBody, requestId: reqId } = job.data;
          requestId = reqId;
          await job.log(`[BullMQ] [${category}] Starting job ${job.id} (requestId: ${requestId})`);
          try {
            jobData = await processPublishJob(reqBody, requestId);
          } catch (err) {
            const errMsg = `[BullMQ] [${category}] Error in processPublishJob for job ${job.id} (requestId: ${requestId}): ${err && err.stack ? err.stack : err}`;
            console.error(errMsg);
            await job.log(errMsg);
            return { status: 'error', message: errMsg };
          }
        } else {
          // New format: per-website job
          const { website, content, campaignId, userId, minimumInclude, requestId: reqId } = job.data;
          requestId = reqId;
          await job.log(`[BullMQ] [${category}] Starting job ${job.id} (requestId: ${requestId})`);
          // Let errors from processWebsite throw so BullMQ marks the job as failed
          const result = await processWebsite({ requestId, website, content, campaignId }, job);
          return {
            status: result.success ? 'done' : 'error',
            ...result
          };
        }
        // Call processWebsite with job instance
        // return await processWebsite(jobData, job); // <-- Remove this line
      },
      { connection: redisConnectionConfig, concurrency: queueConcurrency }
    );
    console.log(`[BullMQ] Worker started for ${category}Queue`);
  });
};

if (process.env.BULLMQ_WORKER === '1' || require.main === module) {
  startAllCategoryWorkers();
  setInterval(() => {}, 1 << 30);
} 