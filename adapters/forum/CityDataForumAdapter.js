import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class CityDataForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting City-Data forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title, body } = this.content;
        let browser;
        let page;
        try {
            browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            page = await context.newPage();
            await page.route('**/*google-analytics.com*', (route) => route.abort());
            await page.route('**/*doubleclick.net*', (route) => route.abort());
            await page.route('**/*twitter.com*', (route) => route.abort());
            // Login
            await page.goto('https://www.city-data.com/forum/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.locator('#navbar_username').fill(username);
            await page.locator('#navbar_password').fill(password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                page.locator('td.alt2 input[type="submit"]').click()
            ]);
            // Go to forum
            await page.goto('https://www.city-data.com/forum/world/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            // New thread
            const newThreadButton = page.getByAltText('Post New Thread').first();
            await newThreadButton.click();
            // Wait for form or rate limit
            const subjectInputLocator = page.locator('#inputthreadtitle');
            const rateLimitLocator = page.locator('div.panel:has-text("You have reached the maximum number of threads")');
            try {
                await Promise.race([
                    subjectInputLocator.waitFor({ state: 'visible', timeout: 30000 }),
                    rateLimitLocator.waitFor({ state: 'visible', timeout: 30000 })
                ]);
            } catch (e) {
                throw new Error('Neither the new thread form nor a rate limit message appeared.');
            }
            if (await rateLimitLocator.isVisible()) {
                const errorMessage = await rateLimitLocator.innerText();
                throw new Error(`Rate limit reached: ${errorMessage.trim()}`);
            }
            await subjectInputLocator.fill(`${title}`);
            await page.locator('#vB_Editor_001_textarea').click();
            await page.locator('#vB_Editor_001_textarea').fill(body);
            const postButton = page.locator('#vB_Editor_001_save');
            await postButton.click();
            await page.waitForURL('**/forum/world/*.html', { timeout: 60000 });
            const finalUrl = page.url();
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log('Cloudinary config at upload:', cloudinary.config());
            console.log('Uploading file:', screenshotPath, 'Exists:', fs.existsSync(screenshotPath));
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            this.log(`[SUCCESS] City-Data forum post created: ${finalUrl}`, 'success', true);
            this.log(`[SCREENSHOT] Screenshot uploaded: ${cloudinaryUrl}`, 'info', true);
            return { success: true, postUrl: finalUrl, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] CityDataForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export default CityDataForumAdapter; 