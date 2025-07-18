import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import { chromium } from 'patchright';

class ExciteSubmitAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://excitesubmit.com';
    }

    async publish() {
        this.log(`[EVENT] Entering ExciteSubmitAdapter publish method for ${this.content.url || this.website.url}.`, 'info', true);
        let browser;
        let context;
        let page;
        let lastApiCall = Date.now();
        let apiCallTimer;
        let screenshotUrl = '';
        let apiCallCount = 0;
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Intercept and log all POST requests to /api.php
            page.on('request', request => {
                if (request.method() === 'POST' && request.url().includes('/api.php')) {
                    lastApiCall = Date.now();
                    apiCallCount++;
                    this.log(`[PING] POST to api.php: ${request.url()} | data: ${request.postData()}`, 'info', true);
                }
            });
            page.on('response', async response => {
                if (response.url().includes('/api.php') && response.request().method() === 'POST') {
                    try {
                        const body = await response.text();
                        this.log(`[PING RESPONSE] ${response.url()} | ${body}`, 'success', true);
                        console.log(`[PING RESPONSE] ${response.url()} | ${body}`);
                    } catch (e) {
                        this.log(`[ERROR] Reading api.php response: ${e.message}`, 'error', true);
                    }
                }
            });

            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to excitesubmit.com', 'detail', false);

            // Fill the input
            const furlInput = page.locator('#furl');
            await furlInput.waitFor({ state: 'visible', timeout: 10000 });
            const urlToPing = this.content && this.content.url ? this.content.url : this.website.url;
            await furlInput.fill(urlToPing);
            this.log(`[EVENT] Filled #furl with: ${urlToPing}`, 'detail', false);

            // Click the submit button
            const submitBtn = page.locator('.frmSubmit[type="button"]');
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            await submitBtn.click();
            this.log('[EVENT] Clicked submit button.', 'detail', false);

            // Wait for inactivity (no api.php POST for 15s)
            await new Promise((resolve) => {
                function checkInactivity() {
                    const now = Date.now();
                    if (now - lastApiCall > 15000 && apiCallCount > 0) {
                        resolve();
                    } else {
                        apiCallTimer = setTimeout(checkInactivity, 1000);
                    }
                }
                checkInactivity();
            });

            // Take screenshot after inactivity
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after 15s inactivity.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            screenshotUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${screenshotUrl}`, 'info', true);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${screenshotUrl}`);
            fs.unlinkSync(screenshotPath);

            return { success: true, screenshotUrl };
        } catch (error) {
            this.log(`[ERROR] ExciteSubmitAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
            }
            throw error;
        } finally {
            if (apiCallTimer) clearTimeout(apiCallTimer);
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

export default ExciteSubmitAdapter; 