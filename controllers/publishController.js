import { v4 as uuidv4 } from 'uuid';
import * as websocketLogger from '../websocketLogger.js';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios'; // Import axios for making API requests
import { Queue, Worker as BullWorker } from 'bullmq';
import IORedis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This will be our new background worker for handling all publications.
// import publishWorker from '../publishWorker.js'; 

// Redis connection for BullMQ
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const publishQueue = new Queue('publishQueue', { connection });

const queueConcurrency = parseInt(process.env.QUEUE_CONCURRENCY, 10) || 1;

// Helper function for main publish logic
async function processPublishJob(reqBody, requestId) {
    let websites = [];
    let workerContent = {};
    let campaign_id = null;
    let user_id = null;
    let parsedContent = {};
    const { title, content, info, api_keys, credential, category, sites_details } = reqBody;
    // 1. Parse content first, as it's common across formats
    console.log(`[${requestId}] Step 1: Parsing content.`);
    if (typeof content === 'string') {
        let cleanedContent = content.trim();
        if (cleanedContent.startsWith('```json')) {
            cleanedContent = cleanedContent.replace(/^```json/, '').trim();
        }
        if (cleanedContent.endsWith('```')) {
            cleanedContent = cleanedContent.replace(/```$/, '').trim();
        }
        try {
            parsedContent = JSON.parse(cleanedContent);
            console.log(`[${requestId}] Content parsed as JSON.`);
        } catch (e) {
            websocketLogger.log(requestId, `❌ Error parsing content JSON: ${e.message}`, 'error');
            console.error(`[${requestId}] Error parsing content JSON: ${e.message}`);
            parsedContent = { markdown: content, html: content };
            console.log(`[${requestId}] Content treated as plain text.`);
        }
    } else if (content && typeof content === 'object') {
        parsedContent = content;
        console.log(`[${requestId}] Content already an object.`);
    }
    let campaign_category = category || (info && info.category);
    let sitesDetails = info ? info.sites_details : (sites_details || []);
    let minimumInclude = 0;
    let availableWebsites = [];
    let skippedWebsites = [];
    const categoryDetail = sitesDetails.find(detail => detail.category === campaign_category);
    if (categoryDetail && categoryDetail.minimumInclude !== undefined) {
        minimumInclude = categoryDetail.minimumInclude;
        websocketLogger.log(requestId, `[Config] Minimum include for category "${campaign_category}": ${minimumInclude}`, 'info');
        console.log(`[${requestId}] Minimum include found: ${minimumInclude}`);
    } else {
        websocketLogger.log(requestId, `[Config] Minimum include not specified for category "${campaign_category}". Will attempt to use all matching websites.`, 'warning');
        console.log(`[${requestId}] Minimum include not specified. Using all matching websites.`);
    }
    console.log(`[${requestId}] Step 3: Filtering websites by category "${campaign_category}" and is_verified.`);
    if (info && info.websites && Array.isArray(info.websites)) {
        availableWebsites = info.websites.filter(site => site.category === campaign_category && site.is_verified);
        websocketLogger.log(requestId, `[Filtering] Found ${availableWebsites.length} verified websites matching category "${campaign_category}".`, 'info');
        console.log(`[${requestId}] Available verified websites after category filter: ${availableWebsites.length}`);
    } else {
        websocketLogger.log(requestId, `[Filtering] No websites found in info.websites or info.websites is not an array.`, 'warning');
        console.error(`[${requestId}] No websites found in info.websites or info.websites is not an array.`);
        return { error: 'No websites provided in info.websites for publication.' };
    }
    console.log(`[${requestId}] Step 4: Validating credentials and selecting target websites.`);
    const availableApiKeys = new Map((api_keys || []).map(key => [key.websiteUrl || key.url, key.credentials]));
    console.log(`[${requestId}] Available API Keys: ${availableApiKeys.size}`);
    const eligibleWebsites = [];
    for (const site of availableWebsites) {
        if (site.have_credential) {
            if (availableApiKeys.has(site.url)) {
                const credentials = availableApiKeys.get(site.url);
                eligibleWebsites.push({ ...site, credentials });
            } else {
                skippedWebsites.push(site.url);
            }
        } else {
            eligibleWebsites.push(site);
        }
    }
    if (eligibleWebsites.length === 0) {
        const errorMessage = `No verified and credentialed websites found for category '${campaign_category}'. Campaign not run.`;
        websocketLogger.log(requestId, `❌ ${errorMessage}`, 'error');
        console.error(`[${requestId}] ${errorMessage}`);
        return { error: errorMessage };
    }
    for (let i = eligibleWebsites.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligibleWebsites[i], eligibleWebsites[j]] = [eligibleWebsites[j], eligibleWebsites[i]];
    }
    websites = eligibleWebsites;
    console.log(`[${requestId}] Final eligible websites to process: ${websites.length}`);
    user_id = info ? info.user_id : (credential ? credential.user_id : null);
    campaign_id = info ? info.campaign_id : (credential ? credential.campaign_id : null);
    console.log(`[${requestId}] User ID: ${user_id}, Campaign ID: ${campaign_id}`);
    if (!user_id || !campaign_id) {
        websocketLogger.log(requestId, `❌ Missing user_id or campaign_id. Cannot proceed with campaign update.`, 'error');
        console.error(`[${requestId}] Missing user_id or campaign_id. Campaign update will be skipped.`);
    }
    workerContent = {
        title: title || parsedContent.title || 'No Title',
        url: parsedContent.url || '',
        tags: parsedContent.tags || '',
        description: parsedContent.description || parsedContent.markdown || parsedContent.html || '',
        markdown: parsedContent.markdown || '',
        html: parsedContent.html || '',
        body: parsedContent.markdown || parsedContent.html || ''
    };
    console.log(`[${requestId}] Worker Content: ${JSON.stringify(workerContent)}`);
    // --- Run the actual process in the background ---
    const workerPath = path.resolve(__dirname, '..', 'publishWorker.js');
    websocketLogger.log(requestId, `🚀 Spawning new worker for request ${requestId}.`);
    console.log(`[${requestId}] Spawning worker at ${workerPath} with data:`, { requestId, websites, content: workerContent, campaignId: campaign_id, userId: user_id });
    const worker = new Worker(workerPath, {
      workerData: { requestId, websites, content: workerContent, campaignId: campaign_id, userId: user_id, minimumInclude }
    });
    worker.on('message', async (message) => {
        websocketLogger.log(requestId, `[Worker Update] ${JSON.stringify(message)}`);
        console.log(`[${requestId}] Worker message received:`, message);
        if (message.status === 'done' || message.status === 'error') {
            if (campaign_id && user_id && message.categorizedLogs) {
                console.log(`[${requestId}] Worker finished, attempting to update campaign ${campaign_id}.`);
                try {
                    const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
                    const updatePayload = {
                        user_id: user_id,
                        logs: {},
                        status: message.status === 'done' ? 'completed' : 'failed',
                    };
                    for (const category in message.categorizedLogs) {
                        if (message.categorizedLogs.hasOwnProperty(category)) {
                            const logsWithCategory = { ...message.categorizedLogs[category], category };
                            updatePayload.logs[category] = JSON.stringify(logsWithCategory);
                        }
                    }
                    const authToken = 'HcjBqsJjLpi0bbg4jbtoi484hfuh9u3ufh98';
                    const apiResponse = await axios.put(apiUpdateUrl, updatePayload, {
                        headers: {
                            'accept': 'application/json',
                            'x-util-secret': `${authToken}`,
                            'Content-Type': 'application/json',
                        }
                    });
                    websocketLogger.log(requestId, `✅ Campaign ${campaign_id} updated with categorized logs. API Response Status: ${apiResponse.status}`);
                    console.log(`[${requestId}] Campaign ${campaign_id} updated.`, apiResponse.data);
                } catch (apiError) {
                    websocketLogger.log(requestId, `❌ Failed to update campaign ${campaign_id} with logs: ${apiError.message}`, 'error');
                    console.error(`[${requestId}] Error updating campaign ${campaign_id}:`, apiError.message);
                    if (apiError.response) {
                        console.error(`[${requestId}] API Error Details:`, apiError.response.data);
                    }
                }
            } else {
                websocketLogger.log(requestId, `[Worker Update] Skipping campaign update: missing campaignId, userId, or categorizedLogs.`, 'warning');
                console.log(`[${requestId}] Skipping campaign update. Missing campaignId, userId, or categorizedLogs.`);
            }
        }
    });
    worker.stdout.on('data', (data) => {
        console.log(`[Worker STDOUT - ${requestId}]: ${data.toString()}`);
        websocketLogger.log(requestId, `[Worker Log]: ${data.toString()}`);
    });
    worker.stderr.on('data', (data) => {
        console.error(`[Worker STDERR - ${requestId}]: ${data.toString()}`);
        websocketLogger.log(requestId, `[Worker Error]: ${data.toString()}`);
    });
    worker.on('error', (error) => {
      websocketLogger.log(requestId, `❌ Worker thread encountered a critical error: ${error.message}`);
      console.error(`Worker error for ${requestId}:`, error);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        websocketLogger.log(requestId, `❗️ Worker thread exited with code ${code}.`);
        console.error(`[${requestId}] Worker thread exited with code ${code}.`);
      } else {
        websocketLogger.log(requestId, `✅ Worker thread finished successfully.`);
        console.log(`[${requestId}] Worker thread finished successfully.`);
      }
    });
    websocketLogger.log(requestId, 'Website List:');
    websites.forEach(site => {
        websocketLogger.log(requestId, ` - ${site.url} (Category: ${site.category})`);
    });
    websocketLogger.log(requestId, 'Processing complete (simulation).');
    console.log(`[${requestId}] Initial processing complete. Worker started.`);
    return { success: true };
}

// BullMQ Worker to process jobs from the queue
const bullWorker = new BullWorker('publishQueue', async (job) => {
    const { reqBody, requestId } = job.data;
    await processPublishJob(reqBody, requestId);
}, { connection, concurrency: queueConcurrency });

export const publish = async (req, res) => {
    const requestId = uuidv4();
    await publishQueue.add('publish', { reqBody: req.body, requestId });
    res.status(202).json({
        message: 'Request received. Processing will start shortly (queued).',
        requestId: requestId
    });
};
