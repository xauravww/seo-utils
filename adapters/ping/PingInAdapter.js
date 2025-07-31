import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import { chromium } from 'patchright';

class PingInAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://ping.in/';
    }

    async publish() {
        this.log(`[EVENT] Entering PingInAdapter publish method for ${this.content.url}.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            this.log('[DEBUG] Launching Chromium browser...', 'detail', false);
            browser = await chromium.launch({ headless: true });
            this.log('[DEBUG] Chromium launched.', 'detail', false);
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(20000);
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            this.log('[EVENT] Locating title input field...', 'detail', false);
            const titleInput = page.locator('input[name="title"]');
            await titleInput.waitFor({ state: 'visible', timeout: 10000 });
            const titleToFill = this.content.title || this.website.title || '';
            await titleInput.fill(titleToFill);
            this.log(`[EVENT] Title input filled with: ${titleToFill}`, 'detail', false);
            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="url"]');
            await urlInput.waitFor({ state: 'visible', timeout: 10000 });
            const urlToFill = this.content.url || this.website.url || '';
            await urlInput.fill(urlToFill);
            this.log(`[EVENT] URL input filled with: ${urlToFill}`, 'detail', false);
            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('button[type="submit"]');
            await submitButton.waitFor({ state: 'visible', timeout: 10000 });
            await submitButton.click();
            this.log('[EVENT] Submit button clicked.', 'detail', false);
            await page.waitForTimeout(3000);
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(cloudinaryUrl);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
            fs.unlinkSync(screenshotPath);
            return { success: true, message: 'Ping submitted and screenshot taken.', screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] PingInAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                this.log(`[EVENT] Error screenshot taken: ${errorScreenshotPath}`, 'info', true);
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                console.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`);
                fs.unlinkSync(errorScreenshotPath);
            }
            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

export default PingInAdapter; 