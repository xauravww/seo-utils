import express from 'express';

import dotenv from 'dotenv';
dotenv.config();
// this was causing env not to load and it always points to the default value of the env variable

import { createServer } from 'http';
import { setupWebSocketServer } from './websocketLogger.js';
import linkedinRoutes from './routes/linkedinRoutes.js';
import publishRoutes from './routes/publishRoutes.js';
import wpPostRoutes from './routes/wpPostRoutes.js';
import redditRoutes from './routes/redditRoutes.js';
import delphiRoutes from './routes/delphiRoutes.js';
import cityDataRoutes from './routes/cityDataRoutes.js';
import simpleMachinesRoutes from './routes/simpleMachinesRoutes.js';
import gentooRoutes from './routes/gentooRoutes.js';
import { loadSessions } from './sessionStore.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swaggerConfig.js';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { queues, categories, redisConnectionConfig } from './controllers/publishController.js';
import { QueueEvents } from 'bullmq';
import os from 'os';
import { exec } from 'child_process';
import * as websocketLogger from './websocketLogger.js';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
console.log('[index.js] REDIS_HOST:', process.env.REDIS_HOST);
const redisProtocol = process.env.REDIS_PROTOCOL || 'redis://';
const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;
const redisPassword = process.env.REDIS_PASSWORD;
const redisUrl = redisPassword
  ? `${redisProtocol}:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
  : `${redisProtocol}${redisHost}:${redisPort}`;
const redis = new Redis(redisUrl);
redis.on('error', (err) => {
  console.error('[index.js][REDIS ERROR]', err);
});
// No need for connect() with ioredis


loadSessions(); // Load sessions from file on startup

// When jobs are created, add their jobIds to a Redis set keyed by campaign_id
// (This should be done where jobs are added, but for now, add a helper for use in publishController.js)
export async function trackCampaignJob(campaignId, jobId) {
  if (campaignId && jobId) {
    await redis.sadd(`campaign_jobs:${campaignId}`, jobId);
  }
}

// Helper to set total jobs for a campaign
export async function setCampaignTotalJobs(campaignId, total) {
  if (campaignId && total) {
    await redis.set(`campaign_total:${campaignId}`, total);
  }
}

// Helper to increment success count for a campaign
export async function incrementCampaignSuccess(campaignId) {
  if (campaignId) {
    await redis.incr(`campaign_success:${campaignId}`);
  }
}

const app = express();
const server = createServer(app); // Create an HTTP server
const PORT = process.env.PORT || 3000;

// Setup Bull Board dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: categories.map(cat => new BullMQAdapter(queues[cat])),
  serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());

// Setup WebSocket server
setupWebSocketServer(server);

// Setup BullMQ QueueEvents listeners to forward logs to websocketLogger
console.log('[BullMQ] Setting up QueueEvents for categories:', categories);
for (const cat of categories) {
  const queueName = `${cat}Queue`;
  const queueEvents = new QueueEvents(queueName, { connection: redisConnectionConfig });
  console.log(`[BullMQ] QueueEvents set up for ${queueName}`);

  // Test QueueEvents connection
  queueEvents.on('waiting', ({ jobId }) => {
    console.log(`[DEBUG] [${cat}] Job ${jobId} is waiting`);
  });

  // Helper to get requestId, campaignId, userId, etc. from jobId
  async function getJobData(jobId) {
    try {
      const job = await queues[cat].getJob(jobId);
      // console.log("job.data we get : ", job.data);
      return job?.data;
    } catch (e) {
      return undefined;
    }
  }

  async function getRequestIdForJob(jobId) {
    const jobData = await getJobData(jobId);
    return jobData?.requestId;
  }

  queueEvents.on('completed', async ({ jobId, returnvalue }) => {
    console.log(`[DEBUG] [${cat}] Job ${jobId} completed event triggered with returnvalue:`, returnvalue);
    const jobData = await getJobData(jobId);
    const requestId = jobData?.requestId;
    const campaign_id = jobData?.campaignId;
    const user_id = jobData?.userId;

    console.log(`[${requestId}] [${cat}] Job ${jobId} completed for campaign ${campaign_id}`);
    
    // REDIS FLAG CHECK: Check if publishWorker.js already updated database
    console.log(`[${requestId}] 🔍 COMPLETED HANDLER DEBUG: Starting Redis flag check for campaign ${campaign_id}`);
    console.log(`[${requestId}] 📊 COMPLETED HANDLER DEBUG: Job details - ID: ${jobId}, Category: ${cat}, Return value: ${JSON.stringify(returnvalue)}`);
    
    if (campaign_id) {
      try {
        console.log(`[${requestId}] 🚩 CHECKING Redis flag: campaign_db_updated:${campaign_id}`);
        const dbUpdatedFlag = await redis.get(`campaign_db_updated:${campaign_id}`);
        console.log(`[${requestId}] 🚩 FLAG RESULT: ${dbUpdatedFlag} (type: ${typeof dbUpdatedFlag})`);
        
        if (dbUpdatedFlag === 'true') {
          console.log(`[${requestId}] 🛡️ WORKER PROTECTION ACTIVATED: Database already updated by publishWorker.js for campaign ${campaign_id}`);
          console.log(`[${requestId}] 🚫 COMPLETED HANDLER EXITING IMMEDIATELY to prevent database override`);
          console.log(`[${requestId}] 🧹 Cleaning up Redis flag: campaign_db_updated:${campaign_id}`);
          
          // Clean up the flag and exit
          await redis.del(`campaign_db_updated:${campaign_id}`);
          console.log(`[${requestId}] ✅ Flag cleaned up successfully`);
          
          websocketLogger.log(requestId, `✅ WORKER PROTECTION: Campaign ${campaign_id} database already updated by worker. Completed handler skipped.`, 'info');
          return; // Exit immediately
        } else {
          console.log(`[${requestId}] 📝 NO FLAG FOUND: Completed handler will continue with normal processing`);
          console.log(`[${requestId}] 🔄 This indicates either: 1) Normal campaign, or 2) Worker hasn't set flag yet`);
        }
      } catch (flagCheckError) {
        console.error(`[${requestId}] ❌ FLAG CHECK ERROR: ${flagCheckError.message}`);
        console.error(`[${requestId}] 🔄 Continuing with normal processing despite flag check error`);
      }
    } else {
      console.log(`[${requestId}] ⚠️ NO CAMPAIGN ID: Skipping flag check (campaign_id is ${campaign_id})`);
    }

    // Remove jobId from campaign set
    if (campaign_id) {
      await redis.srem(`campaign_jobs:${campaign_id}`, jobId);
      // If job succeeded, increment success count
      const message = returnvalue || {};
      if (message.status === 'done') {
        await incrementCampaignSuccess(campaign_id);
        console.log(`[${requestId}] [${cat}] Job ${jobId} marked as successful`);
      }
      const remaining = await redis.scard(`campaign_jobs:${campaign_id}`);
      console.log(`[${requestId}] Campaign ${campaign_id}: ${remaining} jobs remaining`);
      if (remaining === 0) {
        // AGGRESSIVE RETRY DETECTION: Check database first before any processing
        console.log(`[${requestId}] AGGRESSIVE RETRY CHECK: Checking database before processing campaign ${campaign_id}`);
        
        try {
          const authToken = process.env.UTIL_TOKEN;
          const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
          const quickCheckResponse = await axios.get(`${apiUpdateUrl}`, {
            headers: {
              'accept': 'application/json',
              'x-util-secret': authToken,
            }
          });
          
          if (quickCheckResponse.data && quickCheckResponse.data.logs && Object.keys(quickCheckResponse.data.logs).length > 0) {
            console.log(`[${requestId}] AGGRESSIVE RETRY DETECTION: Campaign ${campaign_id} already has logs in database. SKIPPING all processing to prevent override.`);
            
            // Clean up Redis keys and exit immediately
            await redis.del(`campaign_jobs:${campaign_id}`);
            await redis.del(`campaign_total:${campaign_id}`);
            await redis.del(`campaign_success:${campaign_id}`);
            await redis.del(`campaign_logs:${campaign_id}`);
            
            websocketLogger.log(requestId, `✅ RETRY PREVENTED: Campaign ${campaign_id} already has logs. Skipped processing to prevent override.`, 'info');
            return; // Exit immediately
          }
        } catch (quickCheckError) {
          console.log(`[${requestId}] Quick retry check failed: ${quickCheckError.message}`);
        }
        
        // All jobs for this campaign are done, get aggregated logs
        console.log(`[${requestId}] Starting log aggregation for campaign ${campaign_id}`);
        const campaignLogsData = await redis.get(`campaign_logs:${campaign_id}`);
        let aggregatedLogs = {};

        if (campaignLogsData) {
          try {
            const parsedData = JSON.parse(campaignLogsData);
            // The logs are already aggregated in our new format
            aggregatedLogs = parsedData.logs || {};
            console.log(`[${requestId}] Found ${Object.keys(aggregatedLogs).length} log categories for campaign ${campaign_id}`);
          } catch (parseError) {
            console.error(`[${requestId}] Error parsing campaign logs for ${campaign_id}:`, parseError);
            // Fallback: try old format in case of mixed data
            try {
              const logEntries = await redis.lrange(`campaign_logs:${campaign_id}`, 0, -1);
              console.log(`[${requestId}] Fallback: found ${logEntries.length} log entries in old format`);
              for (const entry of logEntries) {
                const { logs } = JSON.parse(entry);
                for (const [cat, logObj] of Object.entries(logs)) {
                  if (!aggregatedLogs[cat]) aggregatedLogs[cat] = { logs: [], result: '' };
                  aggregatedLogs[cat].logs.push(...(logObj.logs || []));
                  aggregatedLogs[cat].result = logObj.result || aggregatedLogs[cat].result;
                }
              }
            } catch (fallbackError) {
              console.error(`[${requestId}] Fallback parsing also failed for ${campaign_id}:`, fallbackError);
            }
          }
        } else {
          console.log(`[${requestId}] No campaign logs found for ${campaign_id}`);
        }
        // Compose result string
        const totalCount = parseInt(await redis.get(`campaign_total:${campaign_id}`) || '0', 10);
        const successCount = parseInt(await redis.get(`campaign_success:${campaign_id}`) || '0', 10);
        const resultString = `${successCount}/${totalCount}`;
        const finalStatus = successCount > 0 ? 'completed' : 'failed'; // Failed only if ALL jobs failed
        console.log(`[${requestId}] Campaign ${campaign_id} final stats: ${resultString}, status: ${finalStatus}`);
        console.log(`[${requestId}] QUEUE EVENT DEBUG: Job completed, checking if should update database`);
        console.log(`[${requestId}] QUEUE EVENT DEBUG: Total jobs for campaign: ${totalCount}, Success: ${successCount}`);
        
        // Enhanced retry detection - check if logs already contain retry markers
        let isRetryScenario = false;
        let existingCampaignStatus = null;
        
        // First check: Look for retry markers in the Redis logs themselves
        if (campaignLogsData) {
          try {
            const parsedData = JSON.parse(campaignLogsData);
            if (parsedData.attempts || parsedData.results) {
              // Check if any website has multiple attempts (indicating retries)
              const hasRetries = Object.values(parsedData.attempts || {}).some(attempts => 
                Array.isArray(attempts) && attempts.length > 1
              );
              
              if (hasRetries) {
                isRetryScenario = true;
                console.log(`[${requestId}] RETRY DETECTED: Found multiple attempts in Redis logs for campaign ${campaign_id}`);
              }
            }
          } catch (parseError) {
            console.log(`[${requestId}] Could not parse Redis logs for retry detection: ${parseError.message}`);
          }
        }
        
        // Second check: Compare with database status if first check didn't detect retry
        if (!isRetryScenario && campaign_id && user_id) {
          try {
            const authToken = process.env.UTIL_TOKEN;
            const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
            const existingCampaignResponse = await axios.get(`${apiUpdateUrl}`, {
              headers: {
                'accept': 'application/json',
                'x-util-secret': authToken,
              }
            });
            
            if (existingCampaignResponse.data) {
              existingCampaignStatus = existingCampaignResponse.data.status;
              
              // If campaign was already completed/failed, this is likely a retry
              if (existingCampaignStatus === 'completed' || existingCampaignStatus === 'failed') {
                isRetryScenario = true;
                console.log(`[${requestId}] RETRY DETECTED: Campaign ${campaign_id} was already ${existingCampaignStatus}, processing ${totalCount} job(s). This appears to be a retry.`);
              }
            }
          } catch (fetchError) {
            console.log(`[${requestId}] Could not fetch existing campaign status: ${fetchError.message}`);
          }
        }
        
        // HYBRID APPROACH: If this is a retry scenario, publishWorker.js already updated database
        if (isRetryScenario) {
          console.log(`[${requestId}] 🛡️ RETRY SCENARIO: Database already updated by publishWorker.js to prevent override`);
          console.log(`[${requestId}] 🔄 Queue handler skipping database update for retry protection`);
          
          // Clean up Redis keys and exit early
          console.log(`[${requestId}] Cleaning up Redis keys for retry scenario campaign ${campaign_id}`);
          await redis.del(`campaign_jobs:${campaign_id}`);
          await redis.del(`campaign_total:${campaign_id}`);
          await redis.del(`campaign_success:${campaign_id}`);
          await redis.del(`campaign_logs:${campaign_id}`);
          
          websocketLogger.log(requestId, `✅ Retry completed for campaign ${campaign_id}. Database updated by worker with proper log merging.`, 'info');
          return; // Exit early, don't update database
        }
        
        console.log(`[${requestId}] 📝 NORMAL SCENARIO: Queue handler will update database as usual`);
        
        if (campaign_id && user_id) {
          try {
            const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
            
            // First, fetch existing campaign data to merge logs instead of overriding
            let existingLogs = {};
            try {
              const authToken = process.env.UTIL_TOKEN;
              const existingCampaignResponse = await axios.get(`${apiUpdateUrl}`, {
                headers: {
                  'accept': 'application/json',
                  'x-util-secret': authToken,
                }
              });
              
              if (existingCampaignResponse.data && existingCampaignResponse.data.logs) {
                existingLogs = existingCampaignResponse.data.logs;
                console.log(`[${requestId}] Found existing logs for campaign ${campaign_id}, merging with new logs`);
              }
            } catch (fetchError) {
              console.log(`[${requestId}] Could not fetch existing campaign logs (${fetchError.message}), proceeding with new logs only`);
            }

            // Merge existing logs with new logs (preserve existing, append new)
            const mergedLogs = { ...existingLogs };
            
            for (const category in aggregatedLogs) {
              if (aggregatedLogs.hasOwnProperty(category)) {
                const newCategoryData = {
                  ...aggregatedLogs[category],
                  result: resultString,
                  timestamp: new Date().toISOString(),
                  isRetry: !!existingLogs[category] // Mark as retry if category already exists
                };

                if (existingLogs[category]) {
                  // Category exists - merge logs instead of overriding
                  try {
                    const existingCategoryData = typeof existingLogs[category] === 'string' 
                      ? JSON.parse(existingLogs[category]) 
                      : existingLogs[category];
                    
                    const mergedCategoryData = {
                      logs: [
                        ...(existingCategoryData.logs || []),
                        ...newCategoryData.logs
                      ],
                      result: newCategoryData.result, // Update with latest result
                      lastUpdated: new Date().toISOString(),
                      totalAttempts: (existingCategoryData.totalAttempts || 1) + 1,
                      isRetry: true
                    };
                    
                    mergedLogs[category] = JSON.stringify(mergedCategoryData);
                    console.log(`[${requestId}] MERGED logs for category ${category} (attempt #${mergedCategoryData.totalAttempts})`);
                  } catch (parseError) {
                    console.log(`[${requestId}] Could not parse existing logs for ${category}, using new logs only`);
                    mergedLogs[category] = JSON.stringify(newCategoryData);
                  }
                } else {
                  // New category - add as is
                  mergedLogs[category] = JSON.stringify({
                    ...newCategoryData,
                    totalAttempts: 1,
                    isRetry: false
                  });
                  console.log(`[${requestId}] ADDED new category ${category}`);
                }
              }
            }

            const updatePayload = {
              user_id: user_id,
              logs: mergedLogs, // Use merged logs instead of empty object
              status: finalStatus,
              result: resultString,
            };

            const authToken = process.env.UTIL_TOKEN;
            const apiResponse = await axios.put(apiUpdateUrl, updatePayload, {
              headers: {
                'accept': 'application/json',
                'x-util-secret': authToken,
                'Content-Type': 'application/json',
              }
            });
            websocketLogger.log(requestId, `✅ Campaign ${campaign_id} updated with categorized logs. API Response Status: ${apiResponse.status}, Result: ${resultString}`);
            console.log(`[${requestId}] Campaign ${campaign_id} updated.`, apiResponse.data);
          } catch (apiError) {
            websocketLogger.log(requestId, `❌ Failed to update campaign ${campaign_id} with logs: ${apiError.message}`, 'error');
            console.error(`[${requestId}] Error updating campaign ${campaign_id}:`, apiError.message);
            if (apiError.response) {
              console.error(`[${requestId}] API Error Details:`, apiError.response.data);
            }
          }
        } else {
          websocketLogger.log(requestId, `[Worker Update] Skipping campaign update: missing campaignId or userId.`, 'warning');
          console.log(`[${requestId}] Skipping campaign update. Missing campaignId or userId.`);
        }
        // Clean up Redis keys
        console.log(`[${requestId}] Cleaned up Redis keys for campaign ${campaign_id}`);
        await redis.del(`campaign_jobs:${campaign_id}`);
        await redis.del(`campaign_total:${campaign_id}`);
        await redis.del(`campaign_success:${campaign_id}`);
        await redis.del(`campaign_logs:${campaign_id}`);
      }
    }
    if (requestId) {
      websocketLogger.log(requestId, `[BullMQ] Job ${jobId} completed: ${JSON.stringify(returnvalue)}`, 'success');
    }
  });

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    console.log(`[DEBUG] [${cat}] Job ${jobId} failed event triggered with reason:`, failedReason);
    const jobData = await getJobData(jobId);
    const requestId = jobData?.requestId;
    const campaign_id = jobData?.campaignId;
    const user_id = jobData?.userId;

    console.log(`[${requestId}] [${cat}] Job ${jobId} failed for campaign ${campaign_id}`);
    
    // REDIS FLAG CHECK: Check if publishWorker.js already updated database
    console.log(`[${requestId}] 🔍 FAILED HANDLER DEBUG: Starting Redis flag check for campaign ${campaign_id}`);
    console.log(`[${requestId}] 📊 FAILED HANDLER DEBUG: Job details - ID: ${jobId}, Category: ${cat}, Failed reason: ${failedReason}`);
    
    if (campaign_id) {
      try {
        console.log(`[${requestId}] 🚩 CHECKING Redis flag: campaign_db_updated:${campaign_id}`);
        const dbUpdatedFlag = await redis.get(`campaign_db_updated:${campaign_id}`);
        console.log(`[${requestId}] 🚩 FLAG RESULT: ${dbUpdatedFlag} (type: ${typeof dbUpdatedFlag})`);
        
        if (dbUpdatedFlag === 'true') {
          console.log(`[${requestId}] 🛡️ WORKER PROTECTION ACTIVATED: Database already updated by publishWorker.js for campaign ${campaign_id}`);
          console.log(`[${requestId}] 🚫 FAILED HANDLER EXITING IMMEDIATELY to prevent database override`);
          console.log(`[${requestId}] 🧹 Cleaning up Redis flag: campaign_db_updated:${campaign_id}`);
          
          // Clean up the flag and exit
          await redis.del(`campaign_db_updated:${campaign_id}`);
          console.log(`[${requestId}] ✅ Flag cleaned up successfully`);
          
          websocketLogger.log(requestId, `✅ WORKER PROTECTION: Campaign ${campaign_id} database already updated by worker. Failed handler skipped.`, 'info');
          return; // Exit immediately
        } else {
          console.log(`[${requestId}] 📝 NO FLAG FOUND: Failed handler will continue with normal processing`);
          console.log(`[${requestId}] 🔄 This indicates either: 1) Normal campaign, or 2) Worker hasn't set flag yet`);
        }
      } catch (flagCheckError) {
        console.error(`[${requestId}] ❌ FLAG CHECK ERROR: ${flagCheckError.message}`);
        console.error(`[${requestId}] 🔄 Continuing with normal processing despite flag check error`);
      }
    } else {
      console.log(`[${requestId}] ⚠️ NO CAMPAIGN ID: Skipping flag check (campaign_id is ${campaign_id})`);
    }

    // Remove jobId from campaign set
    if (campaign_id) {
      await redis.srem(`campaign_jobs:${campaign_id}`, jobId);
      // Note: Don't increment success count for failed jobs
      const remaining = await redis.scard(`campaign_jobs:${campaign_id}`);
      console.log(`[${requestId}] Campaign ${campaign_id}: ${remaining} jobs remaining`);

      if (remaining === 0) {
        // AGGRESSIVE RETRY DETECTION: Check database first before any processing
        console.log(`[${requestId}] AGGRESSIVE RETRY CHECK: Checking database before processing campaign ${campaign_id}`);
        
        try {
          const authToken = process.env.UTIL_TOKEN;
          const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
          const quickCheckResponse = await axios.get(`${apiUpdateUrl}`, {
            headers: {
              'accept': 'application/json',
              'x-util-secret': authToken,
            }
          });
          
          if (quickCheckResponse.data && quickCheckResponse.data.logs && Object.keys(quickCheckResponse.data.logs).length > 0) {
            console.log(`[${requestId}] AGGRESSIVE RETRY DETECTION: Campaign ${campaign_id} already has logs in database. SKIPPING all processing to prevent override.`);
            
            // Clean up Redis keys and exit immediately
            await redis.del(`campaign_jobs:${campaign_id}`);
            await redis.del(`campaign_total:${campaign_id}`);
            await redis.del(`campaign_success:${campaign_id}`);
            await redis.del(`campaign_logs:${campaign_id}`);
            
            websocketLogger.log(requestId, `✅ RETRY PREVENTED: Campaign ${campaign_id} already has logs. Skipped processing to prevent override.`, 'info');
            return; // Exit immediately
          }
        } catch (quickCheckError) {
          console.log(`[${requestId}] Quick retry check failed: ${quickCheckError.message}`);
        }
        
        // All jobs for this campaign are done, get aggregated logs
        console.log(`[${requestId}] Starting log aggregation for campaign ${campaign_id}`);
        const campaignLogsData = await redis.get(`campaign_logs:${campaign_id}`);
        let aggregatedLogs = {};

        if (campaignLogsData) {
          try {
            const parsedData = JSON.parse(campaignLogsData);
            // The logs are already aggregated in our new format
            aggregatedLogs = parsedData.logs || {};
            console.log(`[${requestId}] Found ${Object.keys(aggregatedLogs).length} log categories for campaign ${campaign_id}`);
          } catch (parseError) {
            console.error(`[${requestId}] Error parsing campaign logs for ${campaign_id}:`, parseError);
          }
        } else {
          console.log(`[${requestId}] No campaign logs found for ${campaign_id}`);
        }

        // Compose result string
        const totalCount = parseInt(await redis.get(`campaign_total:${campaign_id}`) || '0', 10);
        const successCount = parseInt(await redis.get(`campaign_success:${campaign_id}`) || '0', 10);
        const resultString = `${successCount}/${totalCount}`;
        const finalStatus = successCount > 0 ? 'completed' : 'failed'; // Failed only if ALL jobs failed
        console.log(`[${requestId}] Campaign ${campaign_id} final stats: ${resultString}, status: ${finalStatus}`);
        console.log(`[${requestId}] QUEUE EVENT DEBUG: Job failed, checking if should update database`);
        console.log(`[${requestId}] QUEUE EVENT DEBUG: Total jobs for campaign: ${totalCount}, Success: ${successCount}`);
        
        // Enhanced retry detection - check if logs already contain retry markers
        let isRetryScenario = false;
        let existingCampaignStatus = null;
        
        // First check: Look for retry markers in the Redis logs themselves
        if (campaignLogsData) {
          try {
            const parsedData = JSON.parse(campaignLogsData);
            if (parsedData.attempts || parsedData.results) {
              // Check if any website has multiple attempts (indicating retries)
              const hasRetries = Object.values(parsedData.attempts || {}).some(attempts => 
                Array.isArray(attempts) && attempts.length > 1
              );
              
              if (hasRetries) {
                isRetryScenario = true;
                console.log(`[${requestId}] RETRY DETECTED: Found multiple attempts in Redis logs for campaign ${campaign_id}`);
              }
            }
          } catch (parseError) {
            console.log(`[${requestId}] Could not parse Redis logs for retry detection: ${parseError.message}`);
          }
        }
        
        // Second check: Compare with database status if first check didn't detect retry
        if (!isRetryScenario && campaign_id && user_id) {
          try {
            const authToken = process.env.UTIL_TOKEN;
            const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
            const existingCampaignResponse = await axios.get(`${apiUpdateUrl}`, {
              headers: {
                'accept': 'application/json',
                'x-util-secret': authToken,
              }
            });
            
            if (existingCampaignResponse.data) {
              existingCampaignStatus = existingCampaignResponse.data.status;
              
              // If campaign was already completed/failed, this is likely a retry
              if (existingCampaignStatus === 'completed' || existingCampaignStatus === 'failed') {
                isRetryScenario = true;
                console.log(`[${requestId}] RETRY DETECTED: Campaign ${campaign_id} was already ${existingCampaignStatus}, processing ${totalCount} job(s). This appears to be a retry.`);
              }
            }
          } catch (fetchError) {
            console.log(`[${requestId}] Could not fetch existing campaign status: ${fetchError.message}`);
          }
        }
        
        // HYBRID APPROACH: If this is a retry scenario, publishWorker.js already updated database
        if (isRetryScenario) {
          console.log(`[${requestId}] 🛡️ RETRY SCENARIO: Database already updated by publishWorker.js to prevent override`);
          console.log(`[${requestId}] 🔄 Queue handler skipping database update for retry protection`);
          
          // Clean up Redis keys and exit early
          console.log(`[${requestId}] Cleaning up Redis keys for retry scenario campaign ${campaign_id}`);
          await redis.del(`campaign_jobs:${campaign_id}`);
          await redis.del(`campaign_total:${campaign_id}`);
          await redis.del(`campaign_success:${campaign_id}`);
          await redis.del(`campaign_logs:${campaign_id}`);
          
          websocketLogger.log(requestId, `✅ Retry completed for campaign ${campaign_id}. Database updated by worker with proper log merging.`, 'info');
          return; // Exit early, don't update database
        }
        
        console.log(`[${requestId}] 📝 NORMAL SCENARIO: Queue handler will update database as usual`);

        if (campaign_id && user_id) {
          try {
            const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
            
            // First, fetch existing campaign data to merge logs instead of overriding
            let existingLogs = {};
            try {
              const authToken = process.env.UTIL_TOKEN;
              const existingCampaignResponse = await axios.get(`${apiUpdateUrl}`, {
                headers: {
                  'accept': 'application/json',
                  'x-util-secret': authToken,
                }
              });
              
              if (existingCampaignResponse.data && existingCampaignResponse.data.logs) {
                existingLogs = existingCampaignResponse.data.logs;
                console.log(`[${requestId}] Found existing logs for campaign ${campaign_id}, merging with new logs`);
              }
            } catch (fetchError) {
              console.log(`[${requestId}] Could not fetch existing campaign logs (${fetchError.message}), proceeding with new logs only`);
            }

            // Merge existing logs with new logs (preserve existing, append new)
            const mergedLogs = { ...existingLogs };
            
            for (const category in aggregatedLogs) {
              if (aggregatedLogs.hasOwnProperty(category)) {
                const newCategoryData = {
                  ...aggregatedLogs[category],
                  result: resultString,
                  timestamp: new Date().toISOString(),
                  isRetry: !!existingLogs[category] // Mark as retry if category already exists
                };

                if (existingLogs[category]) {
                  // Category exists - merge logs instead of overriding
                  try {
                    const existingCategoryData = typeof existingLogs[category] === 'string' 
                      ? JSON.parse(existingLogs[category]) 
                      : existingLogs[category];
                    
                    const mergedCategoryData = {
                      logs: [
                        ...(existingCategoryData.logs || []),
                        ...newCategoryData.logs
                      ],
                      result: newCategoryData.result, // Update with latest result
                      lastUpdated: new Date().toISOString(),
                      totalAttempts: (existingCategoryData.totalAttempts || 1) + 1,
                      isRetry: true
                    };
                    
                    mergedLogs[category] = JSON.stringify(mergedCategoryData);
                    console.log(`[${requestId}] MERGED logs for category ${category} (attempt #${mergedCategoryData.totalAttempts})`);
                  } catch (parseError) {
                    console.log(`[${requestId}] Could not parse existing logs for ${category}, using new logs only`);
                    mergedLogs[category] = JSON.stringify(newCategoryData);
                  }
                } else {
                  // New category - add as is
                  mergedLogs[category] = JSON.stringify({
                    ...newCategoryData,
                    totalAttempts: 1,
                    isRetry: false
                  });
                  console.log(`[${requestId}] ADDED new category ${category}`);
                }
              }
            }

            const updatePayload = {
              user_id: user_id,
              logs: mergedLogs, // Use merged logs instead of empty object
              status: finalStatus,
              result: resultString,
            };

            const authToken = process.env.UTIL_TOKEN;
            const apiResponse = await axios.put(apiUpdateUrl, updatePayload, {
              headers: {
                'accept': 'application/json',
                'x-util-secret': authToken,
                'Content-Type': 'application/json',
              }
            });
            websocketLogger.log(requestId, `✅ Campaign ${campaign_id} updated with categorized logs. API Response Status: ${apiResponse.status}, Result: ${resultString}`);
            console.log(`[${requestId}] Campaign ${campaign_id} updated successfully.`, apiResponse.data);
          } catch (apiError) {
            websocketLogger.log(requestId, `❌ Failed to update campaign ${campaign_id} with logs: ${apiError.message}`, 'error');
            console.error(`[${requestId}] Error updating campaign ${campaign_id}:`, apiError.message);
            if (apiError.response) {
              console.error(`[${requestId}] API Error Details:`, apiError.response.data);
            }
          }
        } else {
          websocketLogger.log(requestId, `[Worker Update] Skipping campaign update: missing campaignId or userId.`, 'warning');
          console.log(`[${requestId}] Skipping campaign update. Missing campaignId or userId.`);
        }

        // Clean up Redis keys
        console.log(`[${requestId}] Cleaned up Redis keys for campaign ${campaign_id}`);
        await redis.del(`campaign_jobs:${campaign_id}`);
        await redis.del(`campaign_total:${campaign_id}`);
        await redis.del(`campaign_success:${campaign_id}`);
        await redis.del(`campaign_logs:${campaign_id}`);
      }
    }

    if (requestId) {
      websocketLogger.log(requestId, `[BullMQ] Job ${jobId} failed: ${failedReason}`, 'error');
    }
  });

  queueEvents.on('log', async ({ jobId, data }) => {
    const requestId = await getRequestIdForJob(jobId);
    if (requestId) {
      websocketLogger.log(requestId, data);
    }
  });
}

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.use((req, res, next) => {
  const start = process.hrtime();
  const originalJson = res.json;

  res.json = (data) => {
    const diff = process.hrtime(start);
    const duration = (diff[0] + diff[1] / 1e9).toFixed(3);
    data.responseTime_seconds = parseFloat(duration);
    originalJson.call(res, data);
  };

  next();
});

app.use(express.json());

// Add the new publish route
app.use('/api/publish', publishRoutes);

// Modular and specific route mounting
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/bloglovin', publishRoutes);
app.use('/api/wordpress', wpPostRoutes);
app.use('/api/reddit', redditRoutes);
app.use('/api/delphi', delphiRoutes);
app.use('/api/city-data', cityDataRoutes);
app.use('/api/simple-machines', simpleMachinesRoutes);
app.use('/api', gentooRoutes);

/**
 * @swagger
 * /admin/queues/worker-health:
 *   get:
 *     summary: Get BullMQ worker and system health
 *     tags: [BullMQ]
 *     description: |
 *       Returns stats for all BullMQ queues (waiting, active, completed, failed) and system stats (RAM, CPU, disk, uptime).
 *       If Accept: text/html, returns a live HTML dashboard.
 *     responses:
 *       200:
 *         description: Health info (JSON or HTML)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'ok' }
 *                 queues:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       waiting: { type: integer, example: 0 }
 *                       active: { type: integer, example: 0 }
 *                       completed: { type: integer, example: 0 }
 *                       failed: { type: integer, example: 0 }
 *                 system: { type: object }
 *                 disk: { type: array }
 *           text/html:
 *             schema:
 *               type: string
 *               example: '<html>...dashboard...</html>'
 */
app.get('/admin/queues/worker-health', async (req, res) => {
  // Helper to get disk space (cross-platform)
  function getDiskSpace(callback) {
    if (process.platform === 'win32') {
      exec('wmic logicaldisk get size,freespace,caption', (err, stdout) => {
        if (err) return callback(null);
        const lines = stdout.trim().split('\n');
        const disks = lines.slice(1).map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length === 3) {
            return {
              drive: parts[0],
              free: Number(parts[1]),
              size: Number(parts[2])
            };
          }
          return null;
        }).filter(Boolean);
        callback(disks);
      });
    } else {
      exec('df -k --output=avail,size,target', (err, stdout) => {
        if (err) return callback(null);
        const lines = stdout.trim().split('\n');
        const disks = lines.slice(1).map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length === 3) {
            return {
              mount: parts[2],
              free: Number(parts[0]) * 1024,
              size: Number(parts[1]) * 1024
            };
          }
          return null;
        }).filter(Boolean);
        callback(disks);
      });
    }
  }

  try {
    // Gather stats for all queues
    const queueStats = {};
    for (const cat of categories) {
      const q = queues[cat];
      queueStats[cat] = {
        waiting: await q.getWaitingCount(),
        active: await q.getActiveCount(),
        completed: await q.getCompletedCount(),
        failed: await q.getFailedCount(),
      };
    }
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const loadAvg = os.loadavg ? os.loadavg() : [];
    const uptime = os.uptime();
    getDiskSpace((diskStats) => {
      // If HTML requested, serve a live UI
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        res.send(`
          <html>
            <head>
              <title>Worker & System Health</title>
              <meta http-equiv="refresh" content="5">
              <style>
                body { font-family: Arial, sans-serif; background: #f9f9f9; color: #222; }
                h2 { color: #007bff; }
                table { border-collapse: collapse; margin: 1em 0; }
                th, td { border: 1px solid #ccc; padding: 0.5em 1em; }
                th { background: #eee; }
              </style>
            </head>
            <body>
              <h2>BullMQ Worker & System Health</h2>
              <table>
                <tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Completed</th><th>Failed</th></tr>
                ${Object.entries(queueStats).map(([cat, stats]) => `<tr><td>${cat}Queue</td><td>${stats.waiting}</td><td>${stats.active}</td><td>${stats.completed}</td><td>${stats.failed}</td></tr>`).join('')}
              </table>
              <table>
                <tr><th>System</th><th>Value</th></tr>
                <tr><td>Total RAM</td><td>${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB</td></tr>
                <tr><td>Free RAM</td><td>${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB</td></tr>
                <tr><td>Used RAM</td><td>${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB</td></tr>
                <tr><td>CPU Load (1/5/15m)</td><td>${loadAvg.map(x => x.toFixed(2)).join(' / ')}</td></tr>
                <tr><td>Uptime</td><td>${(uptime / 60 / 60).toFixed(2)} hours</td></tr>
              </table>
              <table>
                <tr><th>Disk</th><th>Free</th><th>Total</th></tr>
                ${(diskStats || []).map(d => `<tr><td>${d.drive || d.mount}</td><td>${(d.free / 1024 / 1024 / 1024).toFixed(2)} GB</td><td>${(d.size / 1024 / 1024 / 1024).toFixed(2)} GB</td></tr>`).join('')}
              </table>
              <p style="color:#888;">Auto-refreshes every 5 seconds.</p>
            </body>
          </html>
        `);
      } else {
        res.json({
          status: 'ok',
          queues: queueStats,
          system: {
            totalMem, freeMem, usedMem, loadAvg, uptime
          },
          disk: diskStats
        });
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * @swagger
 * /admin/queues/remove-active:
 *   post:
 *     summary: Forcibly remove an active BullMQ job
 *     tags: [BullMQ]
 *     description: |
 *       Moves an active job to failed and removes it from the queue. Use with caution.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [queueName, jobId]
 *             properties:
 *               queueName: { type: string, example: 'pingQueue' }
 *               jobId: { type: string, example: '123' }
 *     responses:
 *       200:
 *         description: Job removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'removed' }
 *                 jobId: { type: string, example: '123' }
 *       400:
 *         description: Missing parameters
 *       404:
 *         description: Queue or job not found
 *       500:
 *         description: Server error
 */
app.post('/admin/queues/remove-active', async (req, res) => {
  const { queueName, jobId } = req.body;
  if (!queueName || !jobId) {
    return res.status(400).json({ error: 'queueName and jobId are required' });
  }
  const queue = queues[queueName.replace('Queue', '')];
  if (!queue) {
    return res.status(404).json({ error: 'Queue not found' });
  }
  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    await job.moveToFailed(new Error('Manually removed by admin'), true);
    await job.remove();
    res.json({ status: 'removed', jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /admin/queues/remove-active-ui:
 *   get:
 *     summary: HTML UI to remove active BullMQ jobs
 *     tags: [BullMQ]
 *     description: |
 *       Simple admin page with a form to remove active jobs by queue and job ID.
 *     responses:
 *       200:
 *         description: HTML form
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: '<html>...form...</html>'
 */
app.get('/admin/queues/remove-active-ui', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Remove Active Job</title>
        <style>
          body { font-family: Arial; margin: 2em; }
          input, select { margin: 0.5em; }
        </style>
      </head>
      <body>
        <h2>Remove Active Job</h2>
        <form id="removeForm">
          <label>Queue Name:
            <select name="queueName">
              ${Object.keys(queues).map(q => `<option value="${q}Queue">${q}Queue</option>`).join('')}
            </select>
          </label>
          <label>Job ID: <input name="jobId" required /></label>
          <button type="submit">Remove Active Job</button>
        </form>
        <div id="result"></div>
        <script>
          document.getElementById('removeForm').onsubmit = async function(e) {
            e.preventDefault();
            const form = e.target;
            const queueName = form.queueName.value;
            const jobId = form.jobId.value;
            const res = await fetch('/admin/queues/remove-active', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ queueName, jobId })
            });
            const data = await res.json();
            document.getElementById('result').innerText = JSON.stringify(data, null, 2);
          };
        </script>
      </body>
    </html>
  `);
});

// API route to get all active jobs and their requestIds
app.get('/api/active-jobs', async (req, res) => {
  try {
    const activeJobs = [];
    for (const cat of categories) {
      const jobs = await queues[cat].getActive();
      for (const job of jobs) {
        if (job.data && job.data.requestId) {
          activeJobs.push({
            jobId: job.id,
            requestId: job.data.requestId,
            category: cat
          });
        }
      }
    }
    res.json(activeJobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  console.log(`BullMQ dashboard is available at http://localhost:${PORT}/admin/queues`)
});
