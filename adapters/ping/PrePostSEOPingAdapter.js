import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import { chromium } from 'patchright';

class PrePostSEOPingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.prepostseo.com/ping-multiple-urls-online';
    }

    async publish() {
        this.log(`[EVENT] Entering PrePostSEOPingAdapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            // Fill textarea with URL
            const urlToFill = this.website.public_website_1 || this.content.url || this.website.url || '';
            this.log(`[EVENT] Filling textarea with URL: ${urlToFill}`, 'detail', false);
            const textarea = page.locator('textarea#urls');
            await textarea.waitFor({ state: 'visible', timeout: 10000 });
            await textarea.fill(urlToFill);

            // Click 'Ping Now' button
            const pingNowBtn = page.locator('span#stepOne');
            await pingNowBtn.waitFor({ state: 'visible', timeout: 10000 });
            await pingNowBtn.click();
            this.log('[EVENT] Clicked Ping Now button.', 'detail', false);

            // Wait for 'Start Pinging' button to appear and click it
            const startPingingBtn = page.locator('span#pingConfirm');
            await startPingingBtn.waitFor({ state: 'visible', timeout: 20000 });
            await startPingingBtn.click();
            this.log('[EVENT] Clicked Start Pinging button.', 'detail', false);

            // Wait for pingBox to appear
            const pingBox = page.locator('div.pingBox');
            await pingBox.waitFor({ state: 'visible', timeout: 60000 });
            this.log('[EVENT] pingBox appeared.', 'detail', false);

            // Monitor pingBox for new pings
            let lastCount = 0;
            let allPingedUrls = [];
            let found63 = false;
            for (let i = 0; i < 180; i++) { // up to 3 minutes
                const html = await pingBox.innerHTML();
                const regex = /<strong>(\d+)<\/strong> : ([^:]+) :: <strong class="text-success">Success<\/strong>/g;
                let match;
                let found = [];
                while ((match = regex.exec(html)) !== null) {
                    found.push({ num: match[1], url: match[2].trim() });
                }
                if (found.length > lastCount) {
                    for (let j = lastCount; j < found.length; j++) {
                        const url = found[j].url;
                        this.log(`Successfully pinged to ${url}`, 'success', true);
                        allPingedUrls.push(url);
                    }
                    lastCount = found.length;
                }
                if (found.some(f => f.num === '63')) {
                    found63 = true;
                    break;
                }
                await page.waitForTimeout(1000);
            }
            if (!found63) {
                this.log('[WARNING] Timeout waiting for ping #63 to finish.', 'warning', true);
            }

            // Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(cloudinaryUrl);
            fs.unlinkSync(screenshotPath);

            return { success: true, pingedUrls: allPingedUrls, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] PrePostSEOPingAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
            }
            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

export default PrePostSEOPingAdapter; 