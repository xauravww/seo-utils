import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class SocialSubmissionEngineAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://socialsubmissionengine.com/';
    }

    async publish() {
        this.log(`[EVENT] Entering SocialSubmissionEngineAdapter publish method.`, 'info', true);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Launching Chromium browser...', 'detail', false);
            browser = await chromium.launch({ headless: true });
            this.log('[DEBUG] Chromium launched.', 'detail', false);
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(10000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            // Step 1: Fill name
            this.log('[EVENT] Filling name input', 'detail', false);
            const nameInput = page.locator('input[name="name"]');
            await nameInput.fill(this.content.name || '');
            this.log(`[DEBUG] Filled name input with: ${this.content.name || ''}`, 'detail', false);

            // Step 2: Fill email
            this.log('[EVENT] Filling email input', 'detail', false);
            const emailInput = page.locator('input[name="email"]');
            await emailInput.fill(this.content.email || '');
            this.log(`[DEBUG] Filled email input with: ${this.content.email || ''}`, 'detail', false);

            // Step 3: Fill custom Website Address
            this.log('[EVENT] Filling custom Website Address input', 'detail', false);
            const websiteInput = page.locator('input[name="custom Website Address"]');
            await websiteInput.fill(this.content.url || '');
            this.log(`[DEBUG] Filled Website Address input with: ${this.content.url || ''}`, 'detail', false);

            // Step 4: Click submit button (input[type="image"][name="submit"])
            this.log('[EVENT] Clicking submit button', 'detail', false);
            const submitButton = page.locator('input[type="image"][name="submit"]');
            await submitButton.click();

            // After clicking submit, take screenshot and close browser immediately
            const screenshotPath = `screenshot_after_submit_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submit button click.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
            fs.unlinkSync(screenshotPath);

            // Check for error or normal message after submit
            const errorSelector = 'p#error-text';
            const confirmationSelector = 'p.Estilo17.style40[align="center"]';

            let messageText = null;
            try {
                const errorElement = await page.locator(errorSelector).elementHandle();
                if (errorElement) {
                    messageText = await page.textContent(errorSelector);
                    this.log(`[INFO] Submission message (error): ${messageText}`, 'info', true);
                    console.log(`[${this.requestId}] [SocialSubmissionEngineAdapter] Submission message (error): ${messageText}`);
                } else {
                    await page.waitForSelector(confirmationSelector, { timeout: 15000 });
                    messageText = await page.textContent(confirmationSelector);
                    this.log(`[INFO] Submission message (confirmation): ${messageText}`, 'info', true);
                    console.log(`[${this.requestId}] [SocialSubmissionEngineAdapter] Submission message (confirmation): ${messageText}`);
                }
            } catch (e) {
                this.log(`[WARNING] No error or confirmation message found after submit: ${e.message}`, 'warning', true);
            }

            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after submit.', 'detail', false);
            }

            return { success: true, message: messageText || 'Submit button clicked and screenshot taken.', screenshotUrl: cloudinaryUrl };

        } catch (error) {
            this.log(`[ERROR] SocialSubmissionEngineAdapter error: ${error.message}`, 'error', true);
            console.error(`[${this.requestId}] [SocialSubmissionEngineAdapter] Error: ${error.message}`);

            if (page) {
                const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                this.log(`[EVENT] Error screenshot taken: ${errorScreenshotPath}`, 'info', true);
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
                console.log(`[${this.requestId}] [SocialSubmissionEngineAdapter] Error screenshot URL: ${errorCloudinaryResult.secure_url}`);
                fs.unlinkSync(errorScreenshotPath);
            }

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

export default SocialSubmissionEngineAdapter; 