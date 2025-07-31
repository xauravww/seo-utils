import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';
import ForumAdapter from './ForumAdapter.js';

class OpenPathshalaForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting OpenPathshala forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title } = this.content;
        let body = this.content.body;
        // If body is not HTML, convert markdown to forum basic HTML
        if (!body || (!body.trim().startsWith('<') && !body.trim().endsWith('>'))) {
            const md = this.content.markdown || body || '';
            body = ForumAdapter.toBasicHtml(md);
        }
        let browser;
        let page;
        let context;
        let postScreenshotUrl = '';
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Step 1: Go to login page
            await page.goto('https://openpathshala.com/user/login', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to login page.', 'detail', false);

            // Step 2: Fill login form
            await page.locator('input#edit-name[name="name"]').fill(username);
            await page.locator('input#edit-pass[name="pass"]').fill(password);
            this.log('[EVENT] Filled login form.', 'detail', false);

            // Step 3: Click login
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#edit-submit[type="submit"]').click()
            ]);
            this.log('[EVENT] Logged in successfully.', 'detail', false);

            // Step 4: Go to new forum post page
            await page.goto('https://openpathshala.com/node/add/forum/1', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to new forum post page.', 'detail', false);

            // Step 5: Fill subject
            await page.locator('input#edit-title[name="title"]').fill(title);
            this.log('[EVENT] Filled subject.', 'detail', false);

            // Step 6: Fill body (supports basic HTML)
            await page.evaluate((html) => {
                // Always set the textarea value
                const textarea = document.querySelector('textarea#edit-body-und-0-value');
                if (textarea) textarea.value = html;
                // If CKEditor is present, setData as well
                if (window.CKEDITOR && window.CKEDITOR.instances && window.CKEDITOR.instances['edit-body-und-0-value']) {
                    window.CKEDITOR.instances['edit-body-und-0-value'].setData(html);
                }
            }, body);
            this.log('[EVENT] Filled body.', 'detail', false);

            // Step 7: Click save
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#edit-submit[type="submit"]').click()
            ]);
            this.log('[EVENT] Submitted forum post.', 'detail', false);

            // Step 8: Get the URL of the posted forum
            const postedUrl = page.url();
            this.log(`[SUCCESS] Forum post created: ${postedUrl}`, 'success', true);

            // Take screenshot after posting
            const postScreenshotPath = `screenshot_post_${this.requestId}.png`;
            await page.screenshot({ path: postScreenshotPath, fullPage: true });
            const postCloudinaryUploadResult = await cloudinary.uploader.upload(postScreenshotPath);
            postScreenshotUrl = postCloudinaryUploadResult.secure_url;
            fs.unlinkSync(postScreenshotPath);
            this.logScreenshotUploaded(postScreenshotUrl);

            return { success: true, postUrl: postedUrl, postScreenshotUrl };
        } catch (error) {
            this.log(`[ERROR] OpenPathshalaForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export default OpenPathshalaForumAdapter; 