import dotenv from 'dotenv';
dotenv.config();
console.log('Cloudinary ENV:', process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET);
import { Worker as BullWorker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
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
  console.log(`[DEBUG] [${requestId}] processWebsite called with:`, {
    url,
    category,
    campaignId,
    hasCredentials: !!website.credentials
  });

  publishLog(requestId, `[Worker] Starting job for ${url}`, 'info');

  // 1. Get the correct adapter for the website
  console.log(`[${requestId}] [Worker] Getting adapter for category: '${category}', url: ${url}`);
  const adapter = getAdapter({ ...jobDetails, job });

  let adapterLogs = []; // Initialize an array to hold logs from this adapter
  // 2. If adapter exists, run it
  if (adapter) {
    console.log(`[${requestId}] [Worker] Adapter found, executing publish for ${url}.`);
    console.log(`[DEBUG] [${requestId}] Adapter type:`, adapter.constructor.name);

    const publishResult = await adapter.publish(job); // Pass job to publish()
    console.log(`[DEBUG] [${requestId}] publishResult:`, {
      success: publishResult.success,
      hasPostUrl: !!publishResult.postUrl,
      hasError: !!publishResult.error
    });

    adapterLogs = adapter.getCollectedLogs(); // Get logs collected by this adapter
    console.log(`[DEBUG] [${requestId}] adapterLogs from getCollectedLogs():`, {
      isArray: Array.isArray(adapterLogs),
      length: adapterLogs ? adapterLogs.length : 'null/undefined',
      logs: adapterLogs
    });

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
    console.log(`[DEBUG] [${requestId}] Final result object:`, {
      success: result.success,
      category: result.category,
      adapterLogsLength: result.adapterLogs ? result.adapterLogs.length : 'null/undefined'
    });

    // Always push at least one log to Redis for aggregation
    if (jobDetails.campaignId) {
      // Ensure we have meaningful logs
      let logsToPush = [];
      if (result.adapterLogs && Array.isArray(result.adapterLogs) && result.adapterLogs.length > 0) {
        logsToPush = result.adapterLogs;
      } else {
        // Create a meaningful default log based on the result
        const defaultMessage = result.success
          ? `Successfully processed ${jobDetails.website.url}`
          : `Failed to process ${jobDetails.website.url}: ${result.error || 'Unknown error'}`;
        logsToPush = [{ message: defaultMessage, level: result.success ? 'success' : 'error' }];
      }

      console.log(`[DEBUG] [${requestId}] logsToPush:`, {
        length: logsToPush.length,
        logs: logsToPush
      });

      // Use parent category for better grouping
      const parentCategory = getParentCategory(result.category);

      // Merge logs with existing campaign logs
      await mergeCampaignLogs(jobDetails.campaignId, {
        userId: jobDetails.userId,
        website: jobDetails.website.url,
        category: parentCategory,
        logs: logsToPush,
        result: result.success ? 'success' : 'failure'
      });

      console.log(`[DEBUG] [${requestId}] Successfully merged logs to Redis campaign_logs:${jobDetails.campaignId}`);
    }
    return result;
  } else {
    const message = `[Worker] No adapter found for category: '${category}' or domain: ${url}`;
    console.warn(`[${requestId}] ${message}`);
    publishLog(requestId, message, 'warning');
    // Push logs to Redis for aggregation, regardless of success
    if (jobDetails.campaignId) {
      const parentCategory = getParentCategory(category);
      await mergeCampaignLogs(jobDetails.campaignId, {
        userId: jobDetails.userId,
        website: jobDetails.website.url,
        category: parentCategory,
        logs: [{ message, level: 'warning' }],
        result: 'failure'
      });
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

  // --- FIXED LOGIC: Process sites sequentially by score priority until minimumInclude OR all sites tried ---
  let successCount = 0;
  let processedCount = 0;
  const maxTries = websites.length;

  console.log(`[${requestId}] Processing websites in score order. MinimumInclude: ${minimumInclude || 'not set'}`);

  // Process websites sequentially (they're already sorted by score in publishController)
  for (let i = 0; i < websites.length; i++) {
    const website = websites[i];
    console.log(`[${requestId}] Processing site ${i + 1}/${websites.length}: ${website.url} (score: ${website.score || 'null'})`);

    const result = await processWebsite({ requestId, website, content, campaignId }, null);
    results.push(result);
    processedCount++;

    if (result && result.success) {
      successCount++;
      console.log(`[${requestId}] Success ${successCount} achieved from ${website.url}`);

      // STOP immediately if we've reached minimumInclude successful posts
      if (minimumInclude && successCount >= minimumInclude) {
        console.log(`[${requestId}] Reached minimumInclude (${minimumInclude}), stopping further processing`);
        break;
      }
    } else {
      allSuccess = false;
      console.log(`[${requestId}] Site ${website.url} failed, continuing to next site`);
    }

    // Aggregate logs by parent category
    if (result.category && result.adapterLogs) {
      const parentCategory = getParentCategory(result.category);
      if (!categorizedLogs[parentCategory]) {
        categorizedLogs[parentCategory] = { logs: [], result: '' };
      }
      categorizedLogs[parentCategory].logs.push(...result.adapterLogs);
    }
  }
  // Add result string to each category - show actual success vs total processed
  for (const cat in categorizedLogs) {
    categorizedLogs[cat].result = `${successCount}/${processedCount}`;
  }
  // --- END FIXED LOGIC ---

  // Always return 'done' status since campaign is always considered completed
  const totalProcessed = results.length;
  const message = minimumInclude
    ? `Publications completed: ${successCount}/${minimumInclude} (minimum required) out of ${totalProcessed} sites tried`
    : `Publications completed: ${successCount}/${totalProcessed} sites processed`;

  publishLog(requestId, `[Worker] ${message} for request ${requestId}.`, successCount > 0 ? 'success' : 'info');
  console.log(`[${requestId}] [Worker] ${message}.`);

  // Always return 'done' status - campaign completion is determined by job completion, not success rate
  return { status: 'done', results, categorizedLogs, successCount, totalProcessed };
};
console.log('[publishWorker.js] REDIS_HOST:', process.env.REDIS_HOST);

// Replace connection and redisPublisher with ioredis clients
const redisProtocol = process.env.REDIS_PROTOCOL || 'redis://';
const redisHost = process.env.PUBLISH_REDIS_HOST || process.env.REDIS_HOST || 'redis';
const redisPort = process.env.PUBLISH_REDIS_PORT || process.env.REDIS_PORT || 6379;
const redisPassword = process.env.PUBLISH_REDIS_PASSWORD || process.env.REDIS_PASSWORD;
const redisUrl = redisPassword
  ? `${redisProtocol}:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
  : `${redisProtocol}${redisHost}:${redisPort}`;

const connection = new Redis(redisUrl);
const redisPublisher = new Redis(redisUrl);
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

// Function to merge campaign logs atomically with proper retry handling
const mergeCampaignLogs = async (campaignId, newLogData) => {
  const key = `campaign_logs:${campaignId}`;

  try {
    // Use Redis WATCH for atomic operations to prevent race conditions during retries
    await connection.watch(key);
    
    // Get existing logs from Redis first
    const existingData = await connection.get(key);
    let mergedLogs = {};

    if (existingData) {
      try {
        mergedLogs = JSON.parse(existingData);
        console.log(`[mergeCampaignLogs] Found existing logs in Redis for campaign ${campaignId}, merging with new data`);
        console.log(`[mergeCampaignLogs] Existing Redis logs structure:`, {
          hasLogs: !!mergedLogs.logs,
          hasAttempts: !!mergedLogs.attempts,
          hasResults: !!mergedLogs.results,
          categories: Object.keys(mergedLogs.logs || {}),
          attemptKeys: Object.keys(mergedLogs.attempts || {}),
          resultKeys: Object.keys(mergedLogs.results || {})
        });
      } catch (parseError) {
        console.error(`[mergeCampaignLogs] Error parsing existing Redis data for campaign ${campaignId}:`, parseError);
        mergedLogs = {};
      }
    } else {
      // Redis is empty (likely cleaned up after previous completion), try to fetch from database
      console.log(`[mergeCampaignLogs] No existing logs in Redis for campaign ${campaignId}, checking database...`);
      console.log(`[mergeCampaignLogs] This indicates Redis was cleaned up after previous completion - attempting database fetch`);
      
      try {
        // Import axios dynamically since it's not imported at the top
        const axios = (await import('axios')).default;
        
        const authToken = process.env.UTIL_TOKEN;
        const apiUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaignId}`;
        const dbResponse = await axios.get(apiUrl, {
          headers: {
            'accept': 'application/json',
            'x-util-secret': authToken,
          }
        });
        
        if (dbResponse.status === 200 && dbResponse.data) {
          const dbData = dbResponse.data;
          console.log(`[mergeCampaignLogs] Database response received for campaign ${campaignId}:`, {
            hasLogs: !!dbData.logs,
            status: dbData.status,
            logCategories: dbData.logs ? Object.keys(dbData.logs) : []
          });
          
          if (dbData && dbData.logs) {
            console.log(`[mergeCampaignLogs] Found existing logs in database for campaign ${campaignId}, converting to Redis format`);
            console.log(`[mergeCampaignLogs] Database logs structure:`, dbData.logs);
            
            // Convert database logs back to Redis format for merging
            mergedLogs = {
              userId: newLogData.userId,
              logs: {},
              attempts: {},
              results: {},
              createdAt: dbData.created_at,
              lastUpdated: new Date().toISOString()
            };
            
            // Parse existing database logs into Redis format
            for (const [category, logData] of Object.entries(dbData.logs)) {
              try {
                const parsedLogData = typeof logData === 'string' ? JSON.parse(logData) : logData;
                mergedLogs.logs[category] = { logs: parsedLogData.logs || [] };
                
                // Reconstruct attempts and results from existing logs
                const websiteKey = `${newLogData.website}_${category}`;
                mergedLogs.attempts[websiteKey] = [{
                  timestamp: parsedLogData.timestamp || dbData.updated_at,
                  result: parsedLogData.result === '1/1' || parsedLogData.result === '1/0' ? 'success' : 'failure',
                  logs: parsedLogData.logs || [],
                  website: newLogData.website,
                  attemptNumber: parsedLogData.totalAttempts || 1,
                  isRetry: parsedLogData.isRetry || false
                }];
                
                mergedLogs.results[websiteKey] = {
                  website: newLogData.website,
                  category: category,
                  finalResult: parsedLogData.result === '1/1' || parsedLogData.result === '1/0' ? 'success' : 'failure',
                  lastAttempt: parsedLogData.timestamp || dbData.updated_at,
                  totalAttempts: parsedLogData.totalAttempts || 1,
                  isRetry: false
                };
              } catch (parseError) {
                console.log(`[mergeCampaignLogs] Could not parse database logs for category ${category}:`, parseError);
              }
            }
          }
        }
      } catch (dbError) {
        console.error(`[mergeCampaignLogs] ERROR: Could not fetch from database for campaign ${campaignId}:`, dbError.message);
        console.error(`[mergeCampaignLogs] ERROR: Database fetch failed, proceeding with empty logs`);
      }
      
      if (Object.keys(mergedLogs).length === 0) {
        console.log(`[mergeCampaignLogs] Creating completely new log structure for campaign ${campaignId}`);
      }
    }

    // Initialize structure if needed (preserve existing data)
    if (!mergedLogs.userId) mergedLogs.userId = newLogData.userId;
    if (!mergedLogs.logs) mergedLogs.logs = {};
    if (!mergedLogs.attempts) mergedLogs.attempts = {}; // Track attempts per website
    if (!mergedLogs.results) mergedLogs.results = {}; // Track final results per website
    if (!mergedLogs.createdAt) mergedLogs.createdAt = new Date().toISOString();
    mergedLogs.lastUpdated = new Date().toISOString();

    // Initialize category if not present
    if (!mergedLogs.logs[newLogData.category]) {
      mergedLogs.logs[newLogData.category] = { logs: [] };
    }

    // Create unique identifier for this website attempt
    const websiteKey = `${newLogData.website}_${newLogData.category}`;
    
    // Initialize attempt tracking for this website (preserve existing attempts)
    if (!mergedLogs.attempts[websiteKey]) {
      mergedLogs.attempts[websiteKey] = [];
    }

    // ENHANCED RETRY DETECTION: Check both Redis and Database
    const existingAttempts = mergedLogs.attempts[websiteKey].length;
    let isRetry = existingAttempts > 0; // Redis-based detection
    
    // ALWAYS check database for existing logs (more reliable than Redis)
    let databaseHasLogs = false;
    try {
      const axios = (await import('axios')).default;
      const authToken = process.env.UTIL_TOKEN;
      const apiUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaignId}`;
      const dbCheckResponse = await axios.get(apiUrl, {
        headers: {
          'accept': 'application/json',
          'x-util-secret': authToken,
        }
      });
      
      if (dbCheckResponse.data && dbCheckResponse.data.logs && Object.keys(dbCheckResponse.data.logs).length > 0) {
        databaseHasLogs = true;
        isRetry = true; // Override Redis detection - database is the source of truth
        console.log(`[mergeCampaignLogs] DATABASE RETRY DETECTION: Campaign ${campaignId} already has logs in database`);
      }
    } catch (dbCheckError) {
      console.log(`[mergeCampaignLogs] Database check failed: ${dbCheckError.message}`);
    }
    
    if (isRetry) {
      console.log(`[mergeCampaignLogs] RETRY detected for ${websiteKey} - attempt #${existingAttempts + 1} (Redis: ${existingAttempts > 0}, Database: ${databaseHasLogs})`);
    }

    // Add this attempt with timestamp and retry info
    const attemptData = {
      timestamp: new Date().toISOString(),
      result: newLogData.result,
      logs: newLogData.logs,
      website: newLogData.website,
      attemptNumber: existingAttempts + 1,
      isRetry: isRetry
    };
    
    mergedLogs.attempts[websiteKey].push(attemptData);

    // Update the final result for this website (latest attempt wins)
    mergedLogs.results[websiteKey] = {
      website: newLogData.website,
      category: newLogData.category,
      finalResult: newLogData.result,
      lastAttempt: new Date().toISOString(),
      totalAttempts: mergedLogs.attempts[websiteKey].length,
      isRetry: isRetry
    };

    // Add logs to category (append all logs for visibility, with retry markers)
    const logsToAdd = newLogData.logs.map(log => ({
      ...log,
      attemptNumber: existingAttempts + 1,
      isRetry: isRetry,
      timestamp: log.timestamp || new Date().toISOString()
    }));
    
    mergedLogs.logs[newLogData.category].logs.push(...logsToAdd);

    // Calculate accurate statistics based on unique websites
    const uniqueWebsites = Object.keys(mergedLogs.results);
    const successfulWebsites = uniqueWebsites.filter(key => 
      mergedLogs.results[key].finalResult === 'success'
    );

    mergedLogs.successCount = successfulWebsites.length;
    mergedLogs.totalCount = uniqueWebsites.length;

    // Update result field for this category based on actual unique results
    const categoryWebsites = uniqueWebsites.filter(key => 
      mergedLogs.results[key].category === newLogData.category
    );
    const categorySuccesses = categoryWebsites.filter(key => 
      mergedLogs.results[key].finalResult === 'success'
    );
    
    mergedLogs.logs[newLogData.category].result = `${categorySuccesses.length}/${categoryWebsites.length}`;

    // Use Redis transaction to atomically update the data
    const multi = connection.multi();
    multi.set(key, JSON.stringify(mergedLogs));
    
    const result = await multi.exec();
    
    if (result === null) {
      // Transaction was discarded due to WATCH key being modified
      console.log(`[mergeCampaignLogs] Transaction discarded for campaign ${campaignId} due to concurrent modification, retrying...`);
      // Retry the operation
      await connection.unwatch();
      return await mergeCampaignLogs(campaignId, newLogData);
    }

    await connection.unwatch();
    console.log(`[mergeCampaignLogs] Successfully merged logs for campaign ${campaignId}, website ${newLogData.website}. Overall: ${mergedLogs.successCount}/${mergedLogs.totalCount}, Category ${newLogData.category}: ${categorySuccesses.length}/${categoryWebsites.length}`);
    
    // NUCLEAR APPROACH: ALWAYS update database directly and set flag to prevent queue handler override
    console.log(`[mergeCampaignLogs] 🚀 NUCLEAR APPROACH ACTIVATED for campaign ${campaignId}`);
    console.log(`[mergeCampaignLogs] 📊 Campaign Stats: Success=${mergedLogs.successCount}, Total=${mergedLogs.totalCount}`);
    console.log(`[mergeCampaignLogs] 🔍 Retry Detection: isRetry=${isRetry}, databaseHasLogs=${databaseHasLogs}`);
    console.log(`[mergeCampaignLogs] 🌐 Website: ${newLogData.website}, Category: ${newLogData.category}, Result: ${newLogData.result}`);
    console.log(`[mergeCampaignLogs] 📝 Log Count: ${newLogData.logs.length} new logs to merge`);
    
    try {
        const axios = (await import('axios')).default;
        const authToken = process.env.UTIL_TOKEN;
        const apiUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaignId}`;
        
        // Prepare database-compatible logs format
        const dbLogs = {};
        for (const [category, categoryData] of Object.entries(mergedLogs.logs)) {
          dbLogs[category] = JSON.stringify({
            logs: categoryData.logs,
            result: categoryData.result,
            timestamp: mergedLogs.lastUpdated,
            totalAttempts: Object.values(mergedLogs.attempts).filter(attempts => 
              attempts.some(attempt => attempt.logs.some(log => log.message.includes(category)))
            ).length,
            isRetry: true
          });
        }
        
        // Calculate overall status
        const overallStatus = mergedLogs.successCount > 0 ? 'completed' : 'failed';
        const overallResult = `${mergedLogs.successCount}/${mergedLogs.totalCount}`;
        
        const updatePayload = {
          user_id: newLogData.userId,
          logs: dbLogs,
          status: overallStatus,
          result: overallResult,
          updated_by: 'publishWorker_retry'
        };
        
        console.log(`[mergeCampaignLogs] Updating database for retry - Status: ${overallStatus}, Result: ${overallResult}`);
        
        const dbResponse = await axios.put(apiUrl, updatePayload, {
          headers: {
            'accept': 'application/json',
            'x-util-secret': authToken,
            'Content-Type': 'application/json',
          }
        });
        
        console.log(`[mergeCampaignLogs] ✅ Database updated successfully for retry scenario. Status: ${dbResponse.status}`);
        
        // Set a Redis flag to prevent queue handlers from updating database
        await connection.set(`campaign_db_updated:${campaignId}`, 'true', 'EX', 3600); // Expire in 1 hour
        console.log(`[mergeCampaignLogs] 🚩 Set Redis flag to prevent queue handler database update`);
        
      } catch (dbUpdateError) {
        console.error(`[mergeCampaignLogs] ❌ Failed to update database for retry: ${dbUpdateError.message}`);
        // Don't throw error - Redis update was successful, database update is secondary
      }
  } catch (error) {
    console.error(`[mergeCampaignLogs] Error merging logs for campaign ${campaignId}:`, error);
    await connection.unwatch();
    
    // Fallback: store as individual entry if merge fails
    try {
      await connection.rpush(key + '_fallback', JSON.stringify({
        ...newLogData,
        timestamp: new Date().toISOString(),
        error: 'Failed to merge with main logs'
      }));
      console.log(`[mergeCampaignLogs] Stored fallback log for campaign ${campaignId}`);
    } catch (fallbackError) {
      console.error(`[mergeCampaignLogs] Even fallback failed for campaign ${campaignId}:`, fallbackError);
    }
  }
};

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

          try {
            // Process the website
            const result = await processWebsite({ requestId, website, content, campaignId, userId }, job);

            // Return success or throw error for BullMQ to handle correctly
            if (result.success) {
              return {
                status: 'done',
                ...result
              };
            } else {
              // Throw error so BullMQ marks job as "failed"
              // Note: Logs are already updated in processWebsite function
              throw new Error(result.error || 'Publication failed');
            }
          } catch (error) {
            // Handle unexpected errors - still push logs to Redis
            console.error(`[BullMQ] [${category}] Unexpected error in job ${job.id}:`, error);
            await job.log(`[ERROR] Unexpected error: ${error.message}`);

            // Push error log to Redis for campaign tracking
            if (campaignId) {
              const parentCategory = getParentCategory(website.category);
              await mergeCampaignLogs(campaignId, {
                userId: userId,
                website: website.url,
                category: parentCategory,
                logs: [{
                  message: `[SYSTEM ERROR] Unexpected error processing ${website.url}: ${error.message}`,
                  level: 'error'
                }],
                result: 'failure'
              });
            }

            // Re-throw the error so BullMQ marks job as "failed"
            throw error;
          }
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
  setInterval(() => { }, 1 << 30);
} 