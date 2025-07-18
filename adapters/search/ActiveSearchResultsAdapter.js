import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class ActiveSearchResultsAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submissionUrl = 'https://www.activesearchresults.com/addwebsite.php';
    }

    async publish() {
        this.log(`[EVENT] Entering ActiveSearchResultsAdapter publish method for ${this.website.url}.`, 'info', true);
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
            await page.goto(this.submissionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="url"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-url-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[EVENT] Locating Email input field...', 'detail', false);
            const emailInput = page.locator('input[name="email"]');
            try {
                await emailInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling Email input field...', 'detail', false);
                await emailInput.fill(this.website.credentials.email);
                this.log('[EVENT] Email input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill Email input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-email-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-email-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('input[type="submit"][name="submiturl"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);
                const postSubmitScreenshotPath = `${this.requestId}-post-submit-screenshot.png`;
                await page.screenshot({ path: postSubmitScreenshotPath, fullPage: true });
                this.log(`[EVENT] Screenshot taken immediately after submit button click: ${postSubmitScreenshotPath}`, 'info', true);
                const cloudinaryPostSubmitUploadResult = await cloudinary.uploader.upload(postSubmitScreenshotPath);
                this.log(`[EVENT] Post-submit screenshot uploaded to Cloudinary: ${cloudinaryPostSubmitUploadResult.secure_url}`, 'info', true);
                fs.unlinkSync(postSubmitScreenshotPath);
                this.log('[EVENT] Waiting for success message to appear and taking screenshot...', 'detail', false);
                const pageHtml = await page.content();
                this.log(`[DEBUG] Page HTML after submission: ${pageHtml.substring(0, 500)}...`, 'detail', false);
                const successMessageSelector = 'h1';
                try {
                    await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                    const messageText = await page.textContent(successMessageSelector);
                    if (!messageText || !messageText.includes('Added Web Site Confirmation')) {
                        throw new Error('Success message not found or not as expected.');
                    }
                    this.log(`[INFO] Submission confirmation message: ${messageText}`, 'info', true);
                } catch (error) {
                    this.log(`[ERROR] Failed to find submission confirmation message: ${error.message}`, 'error', true);
                    if (page) {
                        await page.screenshot({ path: `${this.requestId}-activesearchresults-confirmation-error-screenshot.png` });
                        this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-confirmation-error-screenshot.png`, 'info', true);
                    }
                    throw error;
                }
                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.', 'info', true);
                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                const cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
                fs.unlinkSync(screenshotPath);
                this.log('[SUCCESS] Script finished successfully.', 'success', true);
                return { success: true, message: 'URL submitted and screenshot taken.', cloudinaryUrl: cloudinaryUrl };
            } catch (error) {
                this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
                this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
                this.log('----------------------', 'error', true);
                this.log('[EVENT] An error occurred.', 'error', true);
                throw error;
            }
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

export default ActiveSearchResultsAdapter; 