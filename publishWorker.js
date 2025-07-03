import { parentPort, workerData } from 'worker_threads';
import * as websocketLogger from './websocketLogger.js';
import { getAdapter } from './controllerAdapters.js';

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

const run = async () => {
    const { requestId, websites, content, campaignId } = workerData;
    console.log(`[${requestId}] [Worker] Background worker starting. Processing ${websites.length} websites.`);

    websocketLogger.log(requestId, `[Worker] Background worker started. Processing ${websites.length} websites.`, 'info');

    let allSuccess = true; // Track overall success
    const results = []; // Array to store results from each adapter
    const categorizedLogs = {}; // Object to store logs categorized by website category

    for (const website of websites) {
        // Pass campaignId to processWebsite
        const result = await processWebsite({ requestId, website, content, campaignId }); // Capture result
        results.push(result); // Store the result
        if (!result || !result.success) { // If any website processing fails
            allSuccess = false;
        }

        // Aggregate logs by parent category
        if (result.category && result.adapterLogs) {
            const parentCategory = getParentCategory(result.category);
            if (!categorizedLogs[parentCategory]) {
                categorizedLogs[parentCategory] = [];
            }
            categorizedLogs[parentCategory].push(...result.adapterLogs);
        }
    }

    if (allSuccess) {
        websocketLogger.log(requestId, `[Worker] All jobs complete for request ${requestId}.`, 'success');
        console.log(`[${requestId}] [Worker] All jobs complete.`);
        if (parentPort) {
            parentPort.postMessage({ status: 'done', results: results, categorizedLogs: categorizedLogs }); // Send back all results and categorized logs
        } else {
            process.exit(0);
        }
    } else {
        websocketLogger.log(requestId, `[Worker] Some jobs failed for request ${requestId}.`, 'error');
        console.error(`[${requestId}] [Worker] Some jobs failed.`);
        if (parentPort) {
            parentPort.postMessage({ status: 'error', message: 'Some publication jobs failed.', categorizedLogs: categorizedLogs }); // Send back categorized logs on error as well
        } else {
            process.exit(1);
        }
    }
};

run().catch(err => {
    // Make sure to log errors to the parent thread or a central log
    const { requestId, campaignId } = workerData;
    console.error(`[${requestId}] [Worker] A critical error occurred in run():`, err);
    websocketLogger.log(requestId, `[Worker] A critical error occurred in worker's run function: ${err.message}`, 'error');
    if (parentPort) {
        // Send back an empty categorizedLogs or partial if an error occurred before aggregation
        parentPort.postMessage({ status: 'error', error: err.message, categorizedLogs: {} }); 
    } else {
        process.exit(1);
    }
}); 