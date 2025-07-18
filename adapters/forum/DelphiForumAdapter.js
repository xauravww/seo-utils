import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class DelphiForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting Delphi forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title, body } = this.content;
        let browser;
        let page;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            page = await context.newPage();
            // Block unnecessary resources
            await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', (route) => route.abort());
            await page.route('**/*google-analytics.com*', (route) => route.abort());
            await page.route('**/*doubleclick.net*', (route) => route.abort());
            await page.route('**/*twitter.com*', (route) => route.abort());
            // Login
            await page.goto('https://secure.delphiforums.com/n/login/login.aspx?webtag=dflogin&seamlesswebtag=https%3a%2f%2fdelphiforums.com%2f%3fredirCnt%3d1', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.locator('#lgnForm_username').fill(username);
            await page.locator('#lgnForm_password').fill(password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.locator('#df_lgnbtn').click()
            ]);
            // Go to forum
            await page.goto('https://forums.delphiforums.com/opinionpolls', { waitUntil: 'domcontentloaded', timeout: 30000 });
            // New topic
            await page.locator('#df_mainstream > div.df-contenthead.df-ch-feed.df-xshide > button.btn.btn-primary.pull-right.df-mainnav.df-new.df-full').click();
            await page.locator('#msg_subject').fill(title);
            //select folder here
            await page.locator('#msg_folderId').selectOption({ value: '10' });
            await page.locator('#cke_1_contents > div').click();
            await page.locator('#cke_1_contents > div').fill(body);
            // Click the 'Post' button by its text
            const postButton = await page.getByRole('button', { name: /Post/i });
            await Promise.all([
                postButton.click(),
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
            ]);
            const finalUrl = await page.url();
            // Screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log('Cloudinary config at upload:', cloudinary.config());
            console.log('Uploading file:', screenshotPath, 'Exists:', fs.existsSync(screenshotPath));
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            this.log(`[SUCCESS] Delphi forum post created: ${finalUrl}`, 'success', true);
            this.log(`[SCREENSHOT] Screenshot uploaded: ${cloudinaryUrl}`, 'info', true);
            return { success: true, postUrl: finalUrl, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] DelphiForumAdapter error: ${error.message}`, 'error', true);
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

export default DelphiForumAdapter; 