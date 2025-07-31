import cloudinary from 'cloudinary';
import fs from 'fs';

class BaseAdapter {
    constructor({ requestId, website, content, job }) {
        this.requestId = requestId;
        this.website = website; // Contains url, category, and credentials
        this.content = content;
        this.category = website.category; // Store category directly for easy access
        this.collectedLogs = []; // Array to store logs for this specific adapter instance
        this.job = job; // BullMQ job instance, if provided
    }

    log(message, level = 'detail', isProductionLog = false) {
        // Add a prefix to distinguish logs from different adapters
        const formattedMessage = `[${this.constructor.name}] ${message}`;
        // Store log message and level internally
        this.collectedLogs.push({ message: formattedMessage, level: level });

        // Only send to websocketLogger if isProductionLog is true OR if not in production environment
        // publishLog is expected to be globally available or injected
        if (isProductionLog || process.env.NODE_ENV !== 'production') {
            if (typeof publishLog === 'function') {
                publishLog(this.requestId, formattedMessage, level);
            }
        }
        if (this.job && typeof this.job.log === 'function') {
            this.job.log(formattedMessage);
        }
    }

    // New method to retrieve collected logs
    getCollectedLogs() {
        if (process.env.NODE_ENV === 'production') {
            // Only return important logs in production
            return this.collectedLogs.filter(log =>
                ['info', 'success', 'warning', 'error'].includes(log.level)
            );
        }
        // In non-production, return all logs
        return this.collectedLogs;
    }

    async publish() {
        throw new Error('Publish method not implemented!');
    }

    // Standardized logging methods for consistent parsing
    logPublicationSuccess(url) {
        this.log(`Publication successful! URL: ${url}`, 'success', true);
    }

    logScreenshotUploaded(url) {
        this.log(`Screenshot uploaded: ${url}`, 'info', true);
    }

    logErrorScreenshotUploaded(url) {
        this.log(`Error screenshot uploaded: ${url}`, 'error', true);
    }

    // Helper to ensure BullMQ marks job as failed on error
    handleError(error, page, browser) {
        this.log(`[ERROR] ${this.constructor.name} error: ${error.message}`, 'error', true);
        return (async () => {
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true }).catch(() => { });
                try {
                    const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                    fs.unlinkSync(errorScreenshotPath);
                    this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                } catch { }
            }
            if (browser) await browser.close().catch(() => { });
            // Rethrow to let BullMQ mark as failed
            throw error;
        })();
    }
}

export default BaseAdapter; 