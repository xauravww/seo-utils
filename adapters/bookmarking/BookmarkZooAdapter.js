import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class BookmarkZooAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://www.bookmarkzoo.win/pages/login';
        this.submitUrl = 'https://www.bookmarkzoo.win/pages/submit';
    }

    async publish() {
        this.log(`[EVENT] Entering BookmarkZooAdapter publish method.`, 'info', true);
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
            page.setDefaultTimeout(60000);
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);
            this.log('[EVENT] Filling login form...', 'detail', false);
            await page.locator('input[name="username"]').fill(this.website.credentials.username);
            await page.locator('input[name="password"]').fill(this.website.credentials.password);
            await page.locator('input[name="captcha"]').fill('2');
            this.log('[EVENT] Login form filled. Clicking login button...', 'detail', false);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input[type="submit"][name="wp-submit"]').click()
            ]);
            this.log('[EVENT] Login successful.', 'detail', false);
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.', 'detail', false);
            this.log('[EVENT] Filling submission form...', 'detail', false);
            await page.locator('input[name="submit_url"]').fill(this.content.url || this.website.url, { timeout: 10000 });
            await page.locator('input[name="submit_title"]').fill(this.content.title, { timeout: 10000 });
            await page.locator('textarea[name="submit_body"]').fill(this.content.body, { timeout: 10000 });
            this.log('[EVENT] Submission form filled. Clicking submit button...', 'detail', false);
            await Promise.all([
                page.waitForResponse(response => response.url().includes('/submit') && response.status() === 200),
                page.locator('button[type="submit"][id="publish"]').click()
            ]);
            this.log('[EVENT] Submit button clicked. Waiting for success message.', 'detail', false);
            const successMessageSelector = 'div.alert.alert-success#msg-flash a';
            await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
            const postUrl = await page.getAttribute(successMessageSelector, 'href');
            if (!postUrl) {
                this.log('Could not extract the posted URL from the success message.', 'error', true);
                throw new Error('Could not extract the posted URL from the success message.');
            }
            this.log(`[SUCCESS] Bookmark posted successfully! URL: ${postUrl}`, 'success', true);
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(cloudinaryUrl);
            console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
            fs.unlinkSync(screenshotPath);
            return { success: true, postUrl: postUrl, cloudinaryUrl: cloudinaryUrl };
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

export default BookmarkZooAdapter; 