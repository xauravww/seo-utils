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
        try {
            const publishResult = await adapter.publish(); // Capture result from adapter
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
            return publishResult; // Return the result
        } catch (adapterError) {
            console.error(`[${requestId}] [Worker] Error during adapter publish for ${url}:`, adapterError);
            websocketLogger.log(requestId, `[Worker] Error during adapter publish for ${url}: ${adapterError.message}`, 'error');
            return { success: false, error: adapterError.message }; // Return failure
        }
    } else {
        const message = `[Worker] No adapter found for category: '${category}' or domain: ${url}`;
        console.warn(`[${requestId}] ${message}`);
        websocketLogger.log(requestId, message, 'warning');
        return { success: false, error: message }; // Return failure if no adapter
    }
};

const run = async () => {
    const { requestId, websites, content } = workerData;
    console.log(`[${requestId}] [Worker] Background worker starting. Processing ${websites.length} websites.`);

    websocketLogger.log(requestId, `[Worker] Background worker started. Processing ${websites.length} websites.`, 'info');

    let allSuccess = true; // Track overall success
    const results = []; // Array to store results from each adapter
    // To run in parallel, Promise.all could be used, but sequential is safer for now.
    for (const website of websites) {
        const result = await processWebsite({ requestId, website, content }); // Capture result
        results.push(result); // Store the result
        if (!result || !result.success) { // If any website processing fails
            allSuccess = false;
        }
    }

    if (allSuccess) {
        websocketLogger.log(requestId, `[Worker] All jobs complete for request ${requestId}.`, 'success');
        console.log(`[${requestId}] [Worker] All jobs complete.`);
        if (parentPort) {
            parentPort.postMessage({ status: 'done', results: results }); // Send back all results
        } else {
            process.exit(0);
        }
    } else {
        websocketLogger.log(requestId, `[Worker] Some jobs failed for request ${requestId}.`, 'error');
        console.error(`[${requestId}] [Worker] Some jobs failed.`);
        if (parentPort) {
            parentPort.postMessage({ status: 'error', message: 'Some publication jobs failed.' });
        } else {
            process.exit(1);
        }
    }
};

run().catch(err => {
    // Make sure to log errors to the parent thread or a central log
    const { requestId } = workerData;
    console.error(`[${requestId}] [Worker] A critical error occurred in run():`, err);
    websocketLogger.log(requestId, `[Worker] A critical error occurred in worker's run function: ${err.message}`, 'error');
    if (parentPort) {
        parentPort.postMessage({ status: 'error', error: err.message });
    } else {
        process.exit(1);
    }
}); 