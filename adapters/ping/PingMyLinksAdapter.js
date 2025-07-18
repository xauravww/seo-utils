import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import { chromium } from 'patchright';

class PingMyLinksAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        // Map categories to their respective PingMyLinks submission URLs
        this.pingUrls = {
            'pingmylinks/googleping': 'https://www.pingmylinks.com/googleping/',
            'pingmylinks/searchsubmission': 'https://www.pingmylinks.com/addurl/searchsubmission/',
            'pingmylinks/socialsubmission': 'https://www.pingmylinks.com/addurl/socialsubmission/',
        };
    }

    async publish() {
        this.log('[EVENT] Entering PingMyLinksAdapter publish method.', 'info', true);
        // Determine the target PingMyLinks URL based on the name
        const targetPingUrl = this.pingUrls[this.website.name];
        if (!targetPingUrl) {
            throw new Error(`Unsupported PingMyLinks name: ${this.website.name}`);
        }
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
            this.log(`[EVENT] Navigating to target page: ${targetPingUrl}`, 'detail', false);
            await page.goto(targetPingUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            this.log('[EVENT] Setting up page event listeners.', 'detail', false);
            page.on('request', request => {
                let curlCommand = `curl '${request.url()}'`
                curlCommand += ` -X ${request.method()}`;
                const headers = request.headers();
                for (const key in headers) {
                    const value = headers[key].replace(/'/g, "'\\''");
                    curlCommand += ` -H '${key}: ${value}'`
                }
                const postData = request.postData();
                if (postData) {
                    curlCommand += ` --data-raw '${postData}'`
                    const urlMatch = postData.match(/(?:^|&)u=([^&]*)/);
                    if (urlMatch && urlMatch[1]) {
                        const pingedUrl = decodeURIComponent(urlMatch[1]);
                    }
                }
            });
            page.on('response', async response => {
                if (response.url().includes('api.php')) {
                    try {
                        const responseBody = await response.text();
                        this.log(`Successfully pinged to this website: ${responseBody}`, 'success', true);
                        console.log(`Successfully pinged to this website: ${responseBody}`);
                    } catch (e) {
                        this.log(`Error reading API.PHP response body: ${e.message}`, 'error', true);
                        console.error(`Error reading API.PHP response body: ${e.message}`);
                    }
                }
            });
            page.on('pageerror', error => {});
            page.on('console', msg => {});
            // START: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC
            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const furlInput = page.locator('#furl');
            try {
                await furlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                let urlToPing = null;
                if (this.content && this.content.url) {
                    urlToPing = this.content.url;
                } else {
                    urlToPing = this.website.url;
                }
                await furlInput.fill(urlToPing);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-furl-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-furl-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('.frmSubmit[type="button"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submit-button-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            // END: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC
            this.log('[EVENT] Waiting for submission completion message (indefinitely)...', 'detail', false);
            const successMessageSelector = 'div.messageok';
            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 0 });
                const messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Submission Complete!')) {
                    this.log(`[SUCCESS] Submission Complete! Message: ${messageText}`, 'success', true);
                } else {
                    this.log(`[WARNING] Submission Complete message found, but text is not as expected: ${messageText}`, 'warning', true);
                }
            } catch (error) {
                this.log(`[ERROR] Failed to find submission complete message: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submission-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submission-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[SUCCESS] Script finished successfully.', 'success', true);
            return { success: true };
        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
            this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
            this.log('----------------------', 'error', true);
            this.log('[EVENT] An error occurred.', 'error', true);
            throw error;
        } finally {
            if (browser) {
                if (page) {
                    const screenshotCompletionPath = `screenshot_completion_${this.requestId}.png`;
                    await page.screenshot({ path: screenshotCompletionPath, fullPage: true });
                    this.log('[EVENT] Screenshot taken after completion.', 'info', true);
                    const cloudinaryUploadCompletionResult = await cloudinary.uploader.upload(screenshotCompletionPath);
                    this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`, 'info', true);
                    console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`);
                    fs.unlinkSync(screenshotCompletionPath);
                } else {
                    this.log('[EVENT] Page instance was not created, skipping completion screenshot.', 'warning', true);
                }
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

export default PingMyLinksAdapter; 