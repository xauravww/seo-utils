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
    // The 'credentials' object is no longer at the top level.
    // It's now part of each item in the 'websites' array.
    console.log("req.body in publish ", JSON.stringify(req.body));
    const { websites: oldFormatWebsites, content: oldFormatContent, api_keys, title, content, user_id, campaign_id } = req.body; // Destructure user_id and campaign_id
    const requestId = uuidv4();

    let websites;
    let workerContent;

    if (api_keys) {
        // Handle new format
        websites = api_keys.map(key => ({
            url: key.websiteUrl || key.url,
            credentials: key.credentials,
            category: key.category || 'blog' // Allow category to be specified, default to 'blog'
        }));
        workerContent = { title, body: content };

        if (!Array.isArray(websites) || websites.length === 0) {
            return res.status(400).json({ message: 'Please provide a list of websites in api_keys.' });
        }
    } else {
        // Handle old format
        websites = oldFormatWebsites;
        workerContent = oldFormatContent;

        if (!websites || !Array.isArray(websites) || websites.length === 0) {
            return res.status(400).json({ message: 'Please provide a list of websites.' });
        }
    }

    // Immediately respond to the client
    res.status(202).json({
        message: 'Request received. Processing will start shortly.',
        requestId: requestId
    });

    // --- Run the actual process in the background ---
    const runInBackground = () => {
        const workerPath = path.resolve(__dirname, '..', 'publishWorker.js');
        websocketLogger.log(requestId, `🚀 Spawning new worker for request ${requestId}.`);
        
        const worker = new Worker(workerPath, {
          // Pass the whole websites array and content.
          // The worker will handle the per-site credentials.
          workerData: { requestId, websites, content: workerContent, campaignId: campaign_id } // Pass campaign_id
        });

        worker.on('message', async (message) => { // Make this async to await API call
            websocketLogger.log(requestId, `[Worker Update] ${JSON.stringify(message)}`);
            // If the worker sends back categorized logs, update the campaign
            if (message.status === 'done' || message.status === 'error') {
                if (campaign_id && user_id && message.categorizedLogs) {
                    try {
                        const apiUpdateUrl = `https://seo-backend-kskt.onrender.com/api/v1/campaigns/${campaign_id}`;
                        const updatePayload = {
                            user_id: user_id,
                            logs: {},
                        };

                        // Convert logs array to string for each category
                        for (const category in message.categorizedLogs) {
                            if (message.categorizedLogs.hasOwnProperty(category)) {
                                updatePayload.logs[category] = JSON.stringify(message.categorizedLogs[category]);
                            }
                        }

                        // Note: You'll need to handle the Authorization Bearer token here.
                        // For a real application, this token should be securely managed, not hardcoded.
                        // For demonstration, I'm using a placeholder token as provided in your example.
                        const authToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NywiZW1haWwiOiJtZGF1cmF2aHVAZ21haWwuY29tIiwicm9sZSI6InVzZXIiLCJjb21wYW55X2lkIjpudWxsLCJpYXQiOjE3NTE1Mjg5NzksImV4cCI6MTc1MTYxNTM3OX0.y731DhgkFB-MKnZ2d1_cmT00FJYgcsRwBvLcV-BHRmc'; // REPLACE WITH ACTUAL TOKEN RETRIEVAL

                        const apiResponse = await axios.put(apiUpdateUrl, updatePayload, {
                            headers: {
                                'accept': 'application/json',
                                'Authorization': `Bearer ${authToken}`,
                                'Content-Type': 'application/json'
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
          } else {
            websocketLogger.log(requestId, `✅ Worker thread finished successfully.`);
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
};
