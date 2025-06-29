import { v4 as uuidv4 } from 'uuid';
import * as websocketLogger from '../websocketLogger.js';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This will be our new background worker for handling all publications.
// import publishWorker from '../publishWorker.js'; 

export const publish = (req, res) => {
    // The 'credentials' object is no longer at the top level.
    // It's now part of each item in the 'websites' array.
    console.log("req.body in publish ", JSON.stringify(req.body));
    const { websites: oldFormatWebsites, content: oldFormatContent, api_keys, title, content } = req.body;
    const requestId = uuidv4();

    let websites;
    let workerContent;

    if (api_keys) {
        // Handle new format
        websites = api_keys.map(key => ({
            url: key.websiteUrl,
            credentials: key.credentials,
            category: 'blog' // Assuming 'blog' for now based on the new structure
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
          workerData: { requestId, websites, content: workerContent }
        });

        worker.on('message', (message) => {
            websocketLogger.log(requestId, `[Worker Update] ${JSON.stringify(message)}`);
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
