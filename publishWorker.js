import { parentPort, workerData } from 'worker_threads';
import * as websocketLogger from './websocketLogger.js';
import { getAdapter } from './controllerAdapters.js';

// TODO: Import the controller adapters
// import { getAdapter } from './controllerAdapters.js';

const processWebsite = async (jobDetails) => {
    const { requestId, website } = jobDetails;
    const { url, category } = website;
    console.log(`[${requestId}] [Worker] Starting job for ${url}`);

    websocketLogger.log(requestId, `[Worker] Starting job for ${url}`, 'info');

    // 1. Get the correct adapter for the website
    console.log(`[${requestId}] [Worker] Getting adapter for category: '${category}', url: ${url}`);
    const adapter = getAdapter(jobDetails);
    
    // 2. If adapter exists, run it
    if (adapter) {
        console.log(`[${requestId}] [Worker] Adapter found, executing publish for ${url}.`);
        await adapter.publish();
        console.log(`[${requestId}] [Worker] Adapter publish completed for ${url}.`);
    } else {
        const message = `[Worker] No adapter found for category: '${category}' or domain: ${url}`;
        console.warn(`[${requestId}] ${message}`);
        websocketLogger.log(requestId, message, 'warning');
    }

    websocketLogger.log(requestId, `[Worker] Finished job for ${url}`, 'info');
    console.log(`[${requestId}] [Worker] Finished job for ${url}`);
};

const run = async () => {
    const { requestId, websites, content } = workerData;
    console.log(`[${requestId}] [Worker] Background worker starting. Processing ${websites.length} websites.`);

    websocketLogger.log(requestId, `[Worker] Background worker started. Processing ${websites.length} websites.`, 'info');

    // To run in parallel, Promise.all could be used, but sequential is safer for now.
    for (const website of websites) {
        await processWebsite({ requestId, website, content });
    }

    websocketLogger.log(requestId, `[Worker] All jobs complete for request ${requestId}.`, 'success');
    console.log(`[${requestId}] [Worker] All jobs complete.`);
    
    if (parentPort) {
        parentPort.postMessage({ status: 'done' });
    } else {
        process.exit(0);
    }
};

run().catch(err => {
    // Make sure to log errors to the parent thread or a central log
    const { requestId } = workerData;
    console.error(`[${requestId}] [Worker] A critical error occurred:`, err);
    websocketLogger.log(requestId, `[Worker] A critical error occurred: ${err.message}`, 'error');
    console.error(err);
    if (parentPort) {
        parentPort.postMessage({ status: 'error', error: err.message });
    } else {
        process.exit(1);
    }
}); 