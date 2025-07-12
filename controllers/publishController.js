import dotenv from 'dotenv';
dotenv.config();
import { v4 as uuidv4 } from 'uuid';
import * as websocketLogger from '../websocketLogger.js';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios'; // Import axios for making API requests
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This will be our new background worker for handling all publications.
// import publishWorker from '../publishWorker.js'; 

console.log('[controllers/publishController.js] REDIS_HOST:', process.env.REDIS_HOST);

const redisProtocol = process.env.REDIS_PROTOCOL || 'redis://';
const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;
const redisPassword = process.env.REDIS_PASSWORD;
const redisUrl = redisPassword
  ? `${redisProtocol}:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
  : `${redisProtocol}${redisHost}:${redisPort}`;

export const redisConnectionConfig = { url: redisUrl };
const redisClient = new Redis(redisUrl);

// Define all main categories
const categories = [
  'blog',
  'article',
  'forum',
  'social_media',
  'search',
  'ping',
  'classified',
  'bookmarking',
  'directory',
  'other'
];

// Create a BullMQ queue for each category
const queues = {};
categories.forEach(cat => {
  queues[cat] = new Queue(`${cat}Queue`, { connection: redisConnectionConfig });
});

// Helper to get the correct queue by category
function getQueueByCategory(category) {
  const cat = (category || '').toLowerCase().trim();
  if (!queues[cat]) {
    console.warn(`[BullMQ] Unknown category "${category}" (normalized: "${cat}"), using 'other' queue.`);
  }
  return queues[cat] || queues['other'];
}

const queueConcurrency = parseInt(process.env.QUEUE_CONCURRENCY, 10) || 1;

// Helper function for main publish logic (no longer spawns worker directly)
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
    // Ensure sitesDetails is always an array before using .find
    let sitesDetails = (info && Array.isArray(info.sites_details))
      ? info.sites_details
      : (Array.isArray(sites_details) ? sites_details : []);
    if (!Array.isArray(sitesDetails)) sitesDetails = [];
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
                if (credentials && Object.keys(credentials).length > 0) {
                    eligibleWebsites.push({ ...site, credentials });
                } else {
                    skippedWebsites.push(site.url);
                    websocketLogger.log(requestId, `[Filtering] Skipping ${site.url} due to missing or empty credentials.`, 'warning');
                }
            } else {
                skippedWebsites.push(site.url);
                websocketLogger.log(requestId, `[Filtering] Skipping ${site.url} due to missing API key.`, 'warning');
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
    // --- Title logic: prefer parsedContent.title if it exists and is non-empty ---
    let finalTitle = title && title.trim() && title !== 'Untitled' ? title : (parsedContent.title && parsedContent.title.trim() ? parsedContent.title : 'Untitled');
    workerContent = {
        title: finalTitle,
        url: (info && info.user && info.user.public_website_1) ? info.user.public_website_1 : (parsedContent.url || ''),
        tags: parsedContent.tags || '',
        description: parsedContent.description || parsedContent.markdown || parsedContent.html || '',
        markdown: parsedContent.markdown || '',
        html: parsedContent.html || '',
        body: parsedContent.markdown || parsedContent.html || ''
    };
    console.log(`[${requestId}] Worker Content: ${JSON.stringify(workerContent)}`);
    // Instead of spawning a worker, just return the job data (actual processing will be done by BullMQ worker)
    return {
        requestId,
        websites,
        content: workerContent,
        campaignId: campaign_id,
        userId: user_id,
        minimumInclude
    };
}

// BullMQ Worker will be set up in a separate file (publishQueueWorker.js)

export { queues, getQueueByCategory, categories, processPublishJob };

export const publish = async (req, res) => {
  console.log("req.body in publish:", JSON.stringify(req.body));
    const requestId = uuidv4();
    console.log("req. id to send:",requestId)
    // Add a job to BullMQ queue for each eligible website
    let originalCategory = req.body.category;
    if (!originalCategory && req.body.info && req.body.info.category) {
      originalCategory = req.body.info.category;
    }
    if (!originalCategory && req.body.info && req.body.info.websites && req.body.info.websites[0] && req.body.info.websites[0].category) {
      originalCategory = req.body.info.websites[0].category;
    }
    const normalizedCategory = (originalCategory || '').toLowerCase().trim();
    console.log('[BullMQ] Submitting jobs with category:', originalCategory, 'normalized:', normalizedCategory);
    const queue = getQueueByCategory(originalCategory);

    // Use processPublishJob to get eligible websites and job data
    const jobData = await processPublishJob(req.body, requestId);
    if (jobData && jobData.websites && Array.isArray(jobData.websites) && jobData.websites.length > 0) {
      for (const website of jobData.websites) {
        await queue.add('publishWebsite', {
          requestId, // unique per job for traceability
          website,
          content: jobData.content,
          campaignId: jobData.campaignId,
          userId: jobData.userId,
          minimumInclude: jobData.minimumInclude
        });
      }
      res.status(202).json({
        message: `Request received. ${jobData.websites.length} jobs queued (one per website).`,
        requestId: requestId
      });
    } else {
      // No eligible websites: push log to Redis and add dummy job
      const campaign_id = jobData.campaignId || (req.body.info && req.body.info.campaign_id);
      const user_id = jobData.userId || (req.body.info && req.body.info.user_id);
      if (campaign_id) {
        await redisClient.rpush(
          `campaign_logs:${campaign_id}`,
          JSON.stringify({
            userId: user_id,
            website: null,
            logs: {
              uncategorized: {
                logs: [{ message: jobData.error || 'No eligible websites found for publication.', level: 'error' }],
                result: 'failure',
              }
            }
          })
        );
        // Add a dummy job to trigger aggregation and update
        await queue.add('publishWebsite', {
          requestId,
          campaignId: campaign_id,
          userId: user_id,
          isDummy: true,
          error: jobData.error || 'No eligible websites found for publication.'
        });
      }
      res.status(400).json({
        message: jobData.error || 'No eligible websites found for publication.',
        requestId: requestId
      });
    }
};
