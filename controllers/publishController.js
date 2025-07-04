import { v4 as uuidv4 } from 'uuid';
import * as websocketLogger from '../websocketLogger.js';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios'; // Import axios for making API requests

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This will be our new background worker for handling all publications.
// import publishWorker from '../publishWorker.js'; 

export const publish = (req, res) => {
    const requestId = uuidv4();
    console.log(`[${requestId}] Request Body: ${JSON.stringify(req.body)}`);

    let websites = [];
    let workerContent = {};
    let campaign_id = null;
    let user_id = null;
    let parsedContent = {};

    const { title, content, info, api_keys, credential, category, sites_details } = req.body;

    // 1. Parse content first, as it's common across formats
    console.log(`[${requestId}] Step 1: Parsing content.`);
    if (typeof content === 'string') {
        let cleanedContent = content.trim();
        // Remove code block markers if present
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
            // If content is not a valid JSON string, treat it as plain text body
            parsedContent = { markdown: content, html: content };
            console.log(`[${requestId}] Content treated as plain text.`);
        }
    } else if (content && typeof content === 'object') {
        // If content is already an object (e.g., { markdown: "...", html: "..." })
        parsedContent = content;
        console.log(`[${requestId}] Content already an object.`);
    }

    // Fix: Use category from top-level or info fallback
    let campaign_category = category || (info && info.category);
    let sitesDetails = info ? info.sites_details : (sites_details || []);
    let minimumInclude = 0;
    let availableWebsites = [];
    let selectedWebsites = [];
    let skippedWebsites = [];

    // 2. Determine minimumInclude count
    console.log(`[${requestId}] Step 2: Determining minimumInclude count for category "${campaign_category}".`);
    const categoryDetail = sitesDetails.find(detail => detail.category === campaign_category);
    if (categoryDetail && categoryDetail.minimumInclude !== undefined) {
        minimumInclude = categoryDetail.minimumInclude;
        websocketLogger.log(requestId, `[Config] Minimum include for category "${campaign_category}": ${minimumInclude}`, 'info');
        console.log(`[${requestId}] Minimum include found: ${minimumInclude}`);
    } else {
        websocketLogger.log(requestId, `[Config] Minimum include not specified for category "${campaign_category}". Will attempt to use all matching websites.`, 'warning');
        console.log(`[${requestId}] Minimum include not specified. Using all matching websites.`);
    }

    // 3. Filter websites by category
    console.log(`[${requestId}] Step 3: Filtering websites by category "${campaign_category}" and is_verified.`);
    if (info && info.websites && Array.isArray(info.websites)) {
        // Only include verified sites
        availableWebsites = info.websites.filter(site => site.category === campaign_category && site.is_verified);
        websocketLogger.log(requestId, `[Filtering] Found ${availableWebsites.length} verified websites matching category "${campaign_category}".`, 'info');
        console.log(`[${requestId}] Available verified websites after category filter: ${availableWebsites.length}`);
    } else {
        websocketLogger.log(requestId, `[Filtering] No websites found in info.websites or info.websites is not an array.`, 'warning');
        console.error(`[${requestId}] No websites found in info.websites or info.websites is not an array.`);
        return res.status(400).json({ message: 'No websites provided in info.websites for publication.' });
    }

    // 4. Validate credentials and select target websites
    console.log(`[${requestId}] Step 4: Validating credentials and selecting target websites.`);
    const availableApiKeys = new Map((api_keys || []).map(key => [key.websiteUrl || key.url, key.credentials]));
    console.log(`[${requestId}] Available API Keys: ${availableApiKeys.size}`);

    // Build a pool of all eligible, verified sites (with credentials if needed)
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
        return res.status(400).json({ message: errorMessage });
    }

    // Randomly shuffle eligibleWebsites for fairness
    for (let i = eligibleWebsites.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligibleWebsites[i], eligibleWebsites[j]] = [eligibleWebsites[j], eligibleWebsites[i]];
    }

    // Instead of slicing here, pass the full eligibleWebsites pool to the worker
    websites = eligibleWebsites;
    console.log(`[${requestId}] Final eligible websites to process: ${websites.length}`);

    user_id = info ? info.user_id : (credential ? credential.user_id : null);
    campaign_id = info ? info.campaign_id : (credential ? credential.campaign_id : null);

    console.log(`[${requestId}] User ID: ${user_id}, Campaign ID: ${campaign_id}`);
    if (!user_id || !campaign_id) {
        websocketLogger.log(requestId, `❌ Missing user_id or campaign_id. Cannot proceed with campaign update.`, 'error');
        console.error(`[${requestId}] Missing user_id or campaign_id. Campaign update will be skipped.`);
        // Still allow the worker to run if userId/campaignId are not strictly required for the worker itself
        // but log this as a warning or error for the campaign update part.
    }

    // Set workerContent to include title, url, tags, and description fields
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

    // Immediately respond to the client
    console.log(`[${requestId}] Sending initial response to client.`);
    res.status(202).json({
        message: 'Request received. Processing will start shortly.',
        requestId: requestId,
        selectedWebsitesCount: websites.length,
        skippedWebsitesCount: skippedWebsites.length,
        skippedWebsiteUrls: skippedWebsites
    });

    // --- Run the actual process in the background ---
    const runInBackground = () => {
        const workerPath = path.resolve(__dirname, '..', 'publishWorker.js');
        websocketLogger.log(requestId, `🚀 Spawning new worker for request ${requestId}.`);
        console.log(`[${requestId}] Spawning worker at ${workerPath} with data:`, { requestId, websites, content: workerContent, campaignId: campaign_id, userId: user_id });
        
        const worker = new Worker(workerPath, {
          // Pass the whole websites array and content.
          // The worker will handle the per-site credentials.
          workerData: { requestId, websites, content: workerContent, campaignId: campaign_id, userId: user_id, minimumInclude } // Pass campaign_id, user_id, and minimumInclude
        });

        worker.on('message', async (message) => { // Make this async to await API call
            websocketLogger.log(requestId, `[Worker Update] ${JSON.stringify(message)}`);
            console.log(`[${requestId}] Worker message received:`, message);
            // If the worker sends back categorized logs, update the campaign
            if (message.status === 'done' || message.status === 'error') {
                if (campaign_id && user_id && message.categorizedLogs) {
                    console.log(`[${requestId}] Worker finished, attempting to update campaign ${campaign_id}.`);
                    try {
                        const apiUpdateUrl = `${process.env.MAIN_BACKEND_URL}/api/v1/campaigns/${campaign_id}`;
                        const updatePayload = {
                            user_id: user_id,
                            logs: {},
                            status: message.status === 'done' ? 'completed' : 'failed', // Set status based on worker message
                        };

                        // Convert logs array to string for each category
                        for (const category in message.categorizedLogs) {
                            if (message.categorizedLogs.hasOwnProperty(category)) {
                                // Add category as a property in the logs object
                                const logsWithCategory = { ...message.categorizedLogs[category], category };
                                updatePayload.logs[category] = JSON.stringify(logsWithCategory);
                            }
                        }

                        // Note: You'll need to handle the Authorization Bearer token here.
                        // For a real application, this token should be securely managed, not hardcoded.
                        // For demonstration, I'm using a placeholder token as provided in your example.
                        const authToken = 'HcjBqsJjLpi0bbg4jbtoi484hfuh9u3ufh98'; // REPLACE WITH ACTUAL TOKEN RETRIEVAL

                        const apiResponse = await axios.put(apiUpdateUrl, updatePayload, {
                            headers: {
                                'accept': 'application/json',
                                'x-util-secret': `${authToken}`,
                                'Content-Type': 'application/json',
                                // 'Authorization':`Bearer ${authToken}`

                            }
                        });
                        websocketLogger.log(requestId, `✅ Campaign ${campaign_id} updated with categorized logs. API Response Status: ${apiResponse.status}`);
                        console.log(`[${requestId}] Campaign ${campaign_id} updated.`, apiResponse.data);
                    } catch (apiError) {
                        websocketLogger.log(requestId, `❌ Failed to update campaign ${campaign_id} with logs: ${apiError.message}`, 'error');
                        console.error(`[${requestId}] Error updating campaign ${campaign_id}:`, apiError.message);
                        // Log more details if it's an Axios error (e.g., response data from API)
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
    };

    runInBackground();

    // For now, let's just log the websites that would be processed
    websocketLogger.log(requestId, 'Website List:');
    websites.forEach(site => {
        websocketLogger.log(requestId, ` - ${site.url} (Category: ${site.category})`);
    });
    websocketLogger.log(requestId, 'Processing complete (simulation).');
    console.log(`[${requestId}] Initial processing complete. Worker started.`);
};
