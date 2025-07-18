import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class TeslaPearlBookmarkingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = args.loginUrl || (this.website.url.includes('pearlbookmarking.com')
            ? 'https://pearlbookmarking.com/?success=1#tab-login'
            : 'https://teslabookmarks.com/?success=1#tab-login');
        this.submitUrl = args.submitUrl || (this.website.url.includes('pearlbookmarking.com')
            ? 'https://pearlbookmarking.com/index.php/submit-story/'
            : 'https://teslabookmarks.com/index.php/submit-story/');
        this.reviewUrl = args.reviewUrl || (this.website.url.includes('pearlbookmarking.com')
            ? 'https://pearlbookmarking.com/?status=pending&submitted=1'
            : 'https://teslabookmarks.com/?status=pending&submitted=1');
    }

    async publish() {
        this.log(`[EVENT] Entering TeslaPearlBookmarkingAdapter publish method.`, 'info', true);
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
            page.setDefaultTimeout(40000);
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);
            this.log('[EVENT] Filling login form...', 'detail', false);
            const username = this.website.credentials.username;
            const password = this.website.credentials.password;
            const usernameSelector = 'input[name="log"]';
            const passwordSelector = 'input[name="pwd"]';
            if (typeof username === 'string' && username.trim() !== '') {
                await page.locator(usernameSelector).fill(username, { timeout: 10000 });
            } else {
                this.log('[WARNING] Username is missing or empty, skipping fill.', 'warning', true);
            }
            if (typeof password === 'string' && password.trim() !== '') {
                await page.locator(passwordSelector).fill(password, { timeout: 10000 });
            } else {
                this.log('[WARNING] Password is missing or empty, skipping fill.', 'warning', true);
            }
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
            const url = this.content.url || this.website.url;
            const title = this.content.title;
            const body = this.content.body;
            const urlSelector = 'input[name="_story_url"]';
            const titleSelector = 'input[name="title"]';
            const bodySelector = 'textarea[name="description"]';
            if (typeof url === 'string' && url.trim() !== '') {
                await page.locator(urlSelector).fill(url, { timeout: 10000 });
            } else {
                this.log('[WARNING] Submission URL is missing or empty, skipping fill.', 'warning', true);
            }
            if (typeof title === 'string' && title.trim() !== '') {
                await page.locator(titleSelector).fill(title, { timeout: 10000 });
            } else {
                this.log('[WARNING] Submission title is missing or empty, skipping fill.', 'warning', true);
            }
            if (typeof body === 'string' && body.trim() !== '') {
                await page.locator(bodySelector).fill(body, { timeout: 10000 });
            } else {
                this.log('[WARNING] Submission body is missing or empty, skipping fill.', 'warning', true);
            }
            const categoryValue = this.website.url.includes('pearlbookmarking.com') ? '2152' : '87550';
            await page.locator('select[name="story_category"]').selectOption({ value: categoryValue });
            this.log('[EVENT] Submission form filled. Clicking submit button...', 'detail', false);
            await page.locator('input[type="submit"][name="submit"]').click();
            await page.waitForTimeout(2000);
            const currentUrlCheck = page.url();
            const errorDiv = await page.locator('div.alert.alert-danger').first();
            let errorText = null;
            if (await errorDiv.isVisible()) {
                errorText = await errorDiv.textContent();
                if (errorText && errorText.includes('The url is already been submitted, but this story is pending review')) {
                    const reviewScreenshotPath = `review_screenshot_${this.requestId}.png`;
                    await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
                    this.log(`[EVENT] Bookmark is in review (duplicate detected). Screenshot taken.`, 'info', true);
                    const cloudinaryReviewUploadResult = await cloudinary.uploader.upload(reviewScreenshotPath);
                    const reviewCloudinaryUrl = cloudinaryReviewUploadResult.secure_url;
                    fs.unlinkSync(reviewScreenshotPath);
                    if (browser) { await browser.close(); this.log('[EVENT] Browser closed after execution.', 'detail', false); }
                    return { success: true, message: 'Bookmark is in review (duplicate detected).', reviewUrl: currentUrlCheck, reviewScreenshot: reviewCloudinaryUrl };
                }
            }
            if (currentUrlCheck.includes('story.php') || currentUrlCheck.startsWith(this.reviewUrl)) {
                const reviewScreenshotPath = `review_screenshot_${this.requestId}.png`;
                await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
                this.log(`[EVENT] Bookmark is in review. Redirected to: ${currentUrlCheck}`, 'info', true);
                this.log('[EVENT] Screenshot taken for review status.', 'info', true);
                const cloudinaryReviewUploadResult = await cloudinary.uploader.upload(reviewScreenshotPath);
                const reviewCloudinaryUrl = cloudinaryReviewUploadResult.secure_url;
                fs.unlinkSync(reviewScreenshotPath);
                if (browser) { await browser.close(); this.log('[EVENT] Browser closed after execution.', 'detail', false); }
                return { success: true, message: 'Bookmark is in review.', reviewUrl: currentUrlCheck, reviewScreenshot: reviewCloudinaryUrl };
            }
            await page.waitForResponse(response => response.url().includes('/submit-story/') && response.status() === 200, { timeout: 10000 });
            this.log('[EVENT] Submit button clicked. Waiting for success message.', 'detail', false);
            const successMessageSelector = 'div.alert.alert-success';
            let messageText = null;
            let isSuccess = false;
            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Your story has been submitted. but your story is pending review.')) {
                    isSuccess = true;
                }
            } catch (error) {
                this.log(`[DEBUG] Primary success message not found.`, 'detail', false);
            }
            if (!isSuccess || !messageText) {
                const errorMessage = 'Submission confirmation message not found or not as expected.';
                this.log(`[ERROR] ${errorMessage}`, 'error', true);
                throw new Error(errorMessage);
            }
            this.log(`[SUCCESS] Submission confirmation message: ${messageText}`, 'success', true);
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            return { success: true, message: messageText, reviewUrl: currentUrlCheck, reviewScreenshot: cloudinaryUrl };
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
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

export default TeslaPearlBookmarkingAdapter; 