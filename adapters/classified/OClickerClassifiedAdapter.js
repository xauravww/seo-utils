import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class OClickerClassifiedAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.oclicker.com/post-classified-ads/?ad_type=free&cat=116';
    }

    async publish() {
        this.log(`[EVENT] Entering OClickerClassifiedAdapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        let screenshotUrl = '';
        try {
            browser = await chromium.launch({ headless: false });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            const title = this.content.title || 'Untitled';
            const description = this.content.body || 'Classified description';
            const user = (this.content.info && this.content.info.user) || {};
            const userName = this.content.info?.user_name || user.first_name || 'Sam';
            const userMobile = user.public_mobile_number || '1234567890';
            const userEmail = user.public_email_address || user.email || 'mutebadshah4u@gmail.com';
            await page.locator('input[name="ad[ad_title]"]').fill(title);
            await page.locator('textarea[name="ad[description]"]').fill(description);
            await page.locator('input[name="ad[contact_person]"]').fill(userName);
            await page.locator('input[name="ad[mobile_no]"]').fill(userMobile);
            await page.locator('input[name="ad[email_id]"]').fill(userEmail);
            this.log('[EVENT] All fields filled. Preparing to submit form...', 'detail', false);
            const preClickScreenshotPath = `${this.requestId}-pre-submit-screenshot.png`;
            await page.screenshot({ path: preClickScreenshotPath, fullPage: true });
            this.log(`[DEBUG] Screenshot taken before clicking submit: ${preClickScreenshotPath}`, 'detail', true);
            try {
                const preClickCloudinary = await cloudinary.uploader.upload(preClickScreenshotPath);
                this.logScreenshotUploaded(preClickCloudinary.secure_url);
                fs.unlinkSync(preClickScreenshotPath);
            } catch (e) {
                this.log(`[WARNING] Could not upload/delete pre-submit screenshot: ${e.message}`, 'warning', true);
            }
            const submitSelector = 'input[type="submit"][name="submit"]';
            const submitBtn = page.locator(submitSelector);
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            this.log('[DEBUG] Submit button found and visible.', 'detail', true);
            let clickSuccess = false;
            try {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                    submitBtn.click({ trial: false })
                ]);
                clickSuccess = true;
                this.log('[DEBUG] Submit button clicked using Playwright click.', 'detail', true);
            } catch (err) {
                this.log(`[WARNING] Playwright click failed: ${err.message}. Trying JS click fallback.`, 'warning', true);
                try {
                    await page.evaluate((selector) => {
                        const btn = document.querySelector(selector);
                        if (btn) btn.click();
                    }, submitSelector);
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
                    clickSuccess = true;
                    this.log('[DEBUG] Submit button clicked using JS fallback.', 'detail', true);
                } catch (jsErr) {
                    this.log(`[ERROR] JS click fallback also failed: ${jsErr.message}`, 'error', true);
                }
            }
            const postClickScreenshotPath = `${this.requestId}-post-submit-screenshot.png`;
            await page.screenshot({ path: postClickScreenshotPath, fullPage: true });
            this.log(`[DEBUG] Screenshot taken after clicking submit: ${postClickScreenshotPath}`, 'detail', true);
            try {
                const postClickCloudinary = await cloudinary.uploader.upload(postClickScreenshotPath);
                this.logScreenshotUploaded(postClickCloudinary.secure_url);
                fs.unlinkSync(postClickScreenshotPath);
            } catch (e) {
                this.log(`[WARNING] Could not upload/delete post-submit screenshot: ${e.message}`, 'warning', true);
            }
            if (!clickSuccess) {
                throw new Error('Failed to click submit button with both Playwright and JS fallback.');
            }
            const errorDiv = page.locator('div.alert.alert-danger');
            if (await errorDiv.count() > 0 && await errorDiv.isVisible()) {
                const errorText = await errorDiv.innerText();
                this.log(`[ERROR] Alert after submit: ${errorText}`, 'error', true);
                if (errorText && errorText.includes('Similar ad already exists into your account')) {
                    this.log(`[ERROR] Duplicate ad error after submit: ${errorText}`, 'error', true);
                    throw new Error('Similar ad already exists into your account. Please change Ad Title/Description and resubmit.');
                } else {
                    this.log(`[ERROR] Submission failed with alert-danger: ${errorText}`, 'error', true);
                    throw new Error(`Submission failed: ${errorText}`);
                }
            }
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            screenshotUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(screenshotUrl);
            fs.unlinkSync(screenshotPath);
            return {
                success: true,
                message: 'Classified posted successfully on oclicker.com',
                screenshotUrl
            };
        } catch (error) {
            this.log(`[ERROR] OClickerClassifiedAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export default OClickerClassifiedAdapter; 