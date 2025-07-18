import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';
import ForumAdapter from './ForumAdapter.js';

class BoardsIEForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting Boards.ie forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title } = this.content;
        let body = this.content.body;
        if (!body || (!body.trim().startsWith('<') && !body.trim().endsWith('>'))) {
            const md = this.content.markdown || body || '';
            body = ForumAdapter.toBasicHtml(md);
        }
        let browser;
        let page;
        let context;
        let postScreenshotUrl = '';
        try {
            browser = await chromium.launch({ headless: false });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Step 1: Go to login page
            await page.goto('https://www.boards.ie/entry/signin', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to login page.', 'detail', false);

            // Step 2: Fill login form
            await page.locator('input#Form_Email[name="Email"]').fill(username);
            await page.locator('input#Form_Password[name="Password"]').fill(password);
            this.log('[EVENT] Filled login form.', 'detail', false);

            // Step 3: Click login
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#Form_SignIn[type="submit"]').click()
            ]);
            this.log('[EVENT] Logged in successfully.', 'detail', false);

            // Step 4: Go to new discussion page
            // The new discussion page is usually https://www.boards.ie/post/discussion
            // But to be robust, go to the homepage and click 'Start a Discussion' if needed
            await page.goto('https://www.boards.ie/post/discussion', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to new discussion page.', 'detail', false);

            // --- Cloudflare/Turnstile bypass logic ---
            const cfBypasser = new CloudflareBypasser(page, 5, true);
            await cfBypasser.bypass();
            // --- End bypass logic ---

            await page.goto('https://www.boards.ie/post/discussion', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to new discussion page.', 'detail', false);

            // Step 5: Select category 'Internet Marketing / SEO' (value 985)
            const categorySelector = 'select#Form_CategoryID[name="CategoryID"]';
            await page.waitForSelector(categorySelector, { timeout: 60000 });
            await page.selectOption(categorySelector, { value: '985' });
            this.log('[EVENT] Selected category Internet Marketing / SEO.', 'detail', false);

            // Step 6: Fill title
            await page.locator('input#Form_Name[name="Name"]').fill(title);
            this.log('[EVENT] Filled title.', 'detail', false);

            // Step 7: Fill body (contenteditable div)
            // Click the emoji picker button to activate the editor
            await page.waitForSelector('button#emojiFlyout-0-handle', { timeout: 10000 });
            await page.click('button#emojiFlyout-0-handle');
            // Focus the contenteditable div
            await page.waitForSelector('div[contenteditable="true"][data-slate-editor="true"]', { timeout: 10000 });
            const editableHandle = await page.$('div[contenteditable="true"][data-slate-editor="true"]');
            await editableHandle.focus();
            // Clear any existing content (optional)
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            // Type the body content as a real user would
            await page.keyboard.type(body);
            this.log('[EVENT] Filled body using keyboard.type for Slate.js editor.', 'detail', false);

            this.log('[EVENT] Filled body.', 'detail', false);

            // Step 8: Click 'Post Discussion'
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#Form_PostDiscussion[type="submit"]').click()
            ]);
            this.log('[EVENT] Submitted forum post.', 'detail', false);

            // Step 9: Get the URL of the posted forum
            const postedUrl = page.url();
            this.log(`[SUCCESS] Forum post created: ${postedUrl}`, 'success', true);

            // Take screenshot after posting
            const postScreenshotPath = `screenshot_post_${this.requestId}.png`;
            await page.screenshot({ path: postScreenshotPath, fullPage: true });
            const postCloudinaryUploadResult = await cloudinary.uploader.upload(postScreenshotPath);
            postScreenshotUrl = postCloudinaryUploadResult.secure_url;
            fs.unlinkSync(postScreenshotPath);
            this.log(`[SCREENSHOT] Post screenshot uploaded: ${postScreenshotUrl}`, 'info', true);

            // Only mark as completed if no error occurred
            return { success: true, postUrl: postedUrl, postScreenshotUrl };
        } catch (error) {
            this.log(`[ERROR] BoardsIEForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
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

export default BoardsIEForumAdapter; 