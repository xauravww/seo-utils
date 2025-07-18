import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class SecretSearchEngineLabsAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submissionUrl = 'http://www.secretsearchenginelabs.com/add-url.php';
    }

    async publish() {
        this.log(`[EVENT] Entering SecretSearchEngineLabsAdapter publish method for ${this.website.url}.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            this.log('[DEBUG] Attempting chromium.launch()...', 'detail', false);
            browser = await chromium.launch({ headless: true });
            this.log('[DEBUG] chromium.launch() completed.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);
            context = await browser.newContext();
            page = await context.newPage();
            this.log(`[EVENT] Navigating to submission page: ${this.submissionUrl}`, 'detail', false);
            await page.goto(this.submissionUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="newurl"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-url-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('input[type="submit"][value="Add URL"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submit-button-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[EVENT] Waiting for submission result message...', 'detail', false);
            const successMessageSelector = 'body';
            await page.waitForTimeout(3000);
            let successMessage = '';
            let cloudinaryUrl = '';
            try {
                const bodyContent = await page.textContent('body');
                if (bodyContent.includes('is already included in the index, no need to resubmit!')) {
                    successMessage = `URL ${this.website.url} is already included in the index, no need to resubmit!`;
                    this.log(`[INFO] ${successMessage}`, 'info', true);
                } else if (bodyContent.includes('URL added to queue!')) {
                    successMessage = `URL ${this.website.url} successfully added to queue!`;
                    this.log(`[SUCCESS] ${successMessage}`, 'success', true);
                } else {
                    successMessage = `Unknown submission result for ${this.website.url}. Body content: ${bodyContent.substring(0, 200)}...`;
                    this.log(`[WARNING] ${successMessage}`, 'warning', true);
                }
                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.', 'info', true);
                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
                fs.unlinkSync(screenshotPath);
            } catch (error) {
                this.log(`[ERROR] Failed to determine submission message or upload screenshot: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submission-result-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submission-result-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[SUCCESS] Script finished successfully.', 'success', true);
            return { success: true, message: successMessage, cloudinaryUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
            this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
            this.log('----------------------', 'error', true);
            this.log('[EVENT] An error occurred.', 'error', true);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

export default SecretSearchEngineLabsAdapter; 