import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import { chromium } from 'patchright';

class BacklinkPingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.backlinkping.com/online-ping-website-tool';
    }

    async publish() {
        this.log(`[EVENT] Entering BacklinkPingAdapter publish method.`, 'info', true);
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

            // Prepare values
            const urlToFill = this.website.public_website_1 || this.content.url || this.website.url || '';
            let blogName = this.content.title || this.website.title;
            if (!blogName) {
                try {
                    const urlObj = new URL(urlToFill);
                    const parts = urlObj.hostname.split('.');
                    if (parts.length > 2) {
                        blogName = parts[Math.floor(parts.length / 2)];
                    } else if (parts.length === 2) {
                        blogName = parts[0];
                    } else {
                        blogName = urlObj.hostname;
                    }
                } catch (e) {
                    blogName = urlToFill;
                }
            }
            // Fill all fields
            await page.locator('#myurl').fill(urlToFill);
            await page.locator('#blogNameData').fill(blogName);
            await page.locator('#myBlogUpdateUrlData').fill(urlToFill);
            await page.locator('#myBlogRSSFeedUrlData').fill(urlToFill);
            this.log(`[EVENT] Filled all input fields.`, 'detail', false);

            // Click submit
            const submitBtn = page.locator('#checkButton');
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            await submitBtn.click();
            this.log('[EVENT] Clicked Submit button.', 'detail', false);

            // Wait for the results table to appear
            const tableSelector = 'table.table.table-bordered';
            await page.waitForSelector(tableSelector, { timeout: 60000 });
            this.log('[EVENT] Results table appeared.', 'detail', false);

            // Wait for all statuses to be green or for 'Processing...' to disappear
            let pingedUrls = [];
            for (let i = 0; i < 120; i++) { // up to 2 minutes
                const processingVisible = await page.locator('div:has-text("Processing...")').count();
                const rows = await page.locator(`${tableSelector} tbody tr`).all();
                let allGreen = true;
                pingedUrls = [];
                for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                    const statusCell = await rows[rowIdx].locator('td').nth(2);
                    const statusHtml = await statusCell.innerHTML();
                    if (statusHtml.includes('Thanks for the ping.')) {
                        const urlCell = await rows[rowIdx].locator('td').nth(1);
                        const pingUrl = (await urlCell.innerText()).trim();
                        this.log(`Successfully pinged to ${pingUrl}`, 'success', true);
                        pingedUrls.push(pingUrl);
                    } else {
                        allGreen = false;
                    }
                }
                if (allGreen || processingVisible === 0) {
                    break;
                }
                await page.waitForTimeout(1000);
            }

            // Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(cloudinaryUrl);
            fs.unlinkSync(screenshotPath);

            return { success: true, pingedUrls, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] BacklinkPingAdapter error: ${error.message}`, 'error', true);
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

export default BacklinkPingAdapter; 