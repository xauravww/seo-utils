import dotenv from 'dotenv';
dotenv.config();
console.log('Cloudinary ENV:', process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET);
import { Worker as BullWorker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { parentPort, workerData } from 'worker_threads';
import * as websocketLogger from './websocketLogger.js';
import { getAdapter } from './controllerAdapters.js';
import { processPublishJob } from './controllers/publishController.js';

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

const processWebsite = async (jobDetails) => {
    const { requestId, website, content, campaignId } = jobDetails;
    const { url, category } = website;
    console.log(`[${requestId}] [Worker] Starting job for ${url}`);

    websocketLogger.log(requestId, `[Worker] Starting job for ${url}`, 'info');

    // 1. Get the correct adapter for the website
    console.log(`[${requestId}] [Worker] Getting adapter for category: '${category}', url: ${url}`);
    const adapter = getAdapter(jobDetails);
    
    let adapterLogs = []; // Initialize an array to hold logs from this adapter
    // 2. If adapter exists, run it
    if (adapter) {
        console.log(`[${requestId}] [Worker] Adapter found, executing publish for ${url}.`);
        try {
            const publishResult = await adapter.publish(); // Capture result from adapter
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
            return { ...publishResult, category, adapterLogs }; // Return the result, category and adapter logs
        } catch (adapterError) {
            console.error(`[${requestId}] [Worker] Error during adapter publish for ${url}:`, adapterError);
            websocketLogger.log(requestId, `[Worker] Error during adapter publish for ${url}: ${adapterError.message}`, 'error');
            // Ensure adapterLogs are collected even on error if available
            if (adapter && typeof adapter.getCollectedLogs === 'function') {
                adapterLogs = adapter.getCollectedLogs();
            }
            return { success: false, error: adapterError.message, category, adapterLogs }; // Return failure with category and adapter logs
        }
    } else {
        const message = `[Worker] No adapter found for category: '${category}' or domain: ${url}`;
        console.warn(`[${requestId}] ${message}`);
        websocketLogger.log(requestId, message, 'warning');
        return { success: false, error: message, category, adapterLogs: [{ message, level: 'warning' }] }; // Return failure if no adapter
    }
};

const run = async (workerData) => {
    const { requestId, websites, content, campaignId, minimumInclude } = workerData;
    console.log(`[${requestId}] [Worker] Background worker starting. Processing ${websites.length} websites.`);

    websocketLogger.log(requestId, `[Worker] Background worker started. Processing ${websites.length} websites.`, 'info');

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
        const result = await processWebsite({ requestId, website, content, campaignId });
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
        websocketLogger.log(requestId, `[Worker] Publications completed: ${successCount}/${requiredCount} for request ${requestId}.`, 'success');
        console.log(`[${requestId}] [Worker] Publications completed: ${successCount}/${requiredCount}.`);
        // Remove parentPort.postMessage and always return the result object for BullMQ
        return { status: 'done', results, categorizedLogs };
    } else {
        websocketLogger.log(requestId, `[Worker] No successful publications for request ${requestId}.`, 'error');
        console.error(`[${requestId}] [Worker] No successful publications.`);
        // Remove parentPort.postMessage and always return the error object for BullMQ
        return { status: 'error', message: 'No successful publication jobs.', categorizedLogs };
    }
};

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

// --- BullMQ Worker Setup ---
const queueConcurrency = parseInt(process.env.QUEUE_CONCURRENCY, 10) || 1;

const startBullWorker = () => {
    const bullWorker = new BullWorker('publishQueue', async (job) => {
        const { reqBody, requestId } = job.data;
        await job.log(`[BullMQ] Starting job ${job.id} (requestId: ${requestId})`);
        await job.log(`[BullMQ] Job data: ${JSON.stringify(reqBody).slice(0, 500)}...`);
        try {
            const jobData = await processPublishJob(reqBody, requestId);
            if (!jobData || !jobData.websites) {
                const errMsg = `[${requestId}] [Worker] Invalid job data returned from processPublishJob: ${JSON.stringify(jobData)}`;
                console.error(errMsg);
                await job.log(errMsg);
                return { status: 'error', message: errMsg };
            }
            await job.log(`[BullMQ] Running job for requestId: ${requestId}`);
            const result = await run(jobData);
            await job.log(`[BullMQ] Finished job ${job.id} (requestId: ${requestId})`);
            // Log adapter logs if present
            if (result && result.results && Array.isArray(result.results)) {
                for (const res of result.results) {
                    if (res.adapterLogs && Array.isArray(res.adapterLogs)) {
                        for (const logEntry of res.adapterLogs) {
                            await job.log(`[AdapterLog][${logEntry.level}] ${logEntry.message}`);
                        }
                    }
                }
            }
            // Log categorized logs if present
            if (result && result.categorizedLogs) {
                for (const [cat, catObj] of Object.entries(result.categorizedLogs)) {
                    if (catObj.logs && Array.isArray(catObj.logs)) {
                        for (const logEntry of catObj.logs) {
                            await job.log(`[CatLog][${cat}][${logEntry.level}] ${logEntry.message}`);
                        }
                    }
                }
            }
            return result; // Return the result object
        } catch (err) {
            const errMsg = `[BullMQ] Error in job ${job.id} (requestId: ${requestId}): ${err && err.stack ? err.stack : err}`;
            console.error(errMsg);
            await job.log(errMsg);
            return { status: 'error', message: errMsg };
        }
    }, { connection, concurrency: queueConcurrency });

    // Optional: Listen for job events for logging/debugging
    const queueEvents = new QueueEvents('publishQueue', { connection });
    queueEvents.on('completed', ({ jobId }) => {
        console.log(`[BullMQ] Job ${jobId} completed.`);
    });
    queueEvents.on('failed', ({ jobId, failedReason }) => {
        console.error(`[BullMQ] Job ${jobId} failed: ${failedReason}`);
    });
};

// Only start the worker if this file is run directly
if (process.env.BULLMQ_WORKER === '1' || require.main === module) {
    startBullWorker();
    // Keep the process alive so the worker continues polling for jobs
    setInterval(() => {}, 1 << 30);
    }

export { startBullWorker }; 