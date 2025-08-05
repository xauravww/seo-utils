import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class GainWebAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://gainweb.org/submit.php';
    }

    async publish() {
        this.log(`[EVENT] Entering GainWebAdapter publish method.`, 'info', true);

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

            // Step 1: Click radio button with value="2"
            this.log('[EVENT] Selecting radio button LINK_TYPE value=2', 'detail', false);
            const radioButton = page.locator('input[type="radio"][name="LINK_TYPE"][value="2"]');
            await radioButton.check();

            // Step 2: Fill title
            this.log('[EVENT] Filling title input', 'detail', false);
            const titleInput = page.locator('input#TITLE[name="TITLE"]');
            await titleInput.fill(this.content.title);

            // Step 3: Fill URL
            this.log('[EVENT] Filling URL input', 'detail', false);
            const urlInput = page.locator('input#URL[name="URL"]');
            await urlInput.fill(this.content.url);

            // Step 4: Select category "Search Engine Optimization (SEO)"
            this.log('[EVENT] Selecting category "Search Engine Optimization (SEO)"', 'detail', false);
            const categorySelect = page.locator('select#CATEGORY_ID[name="CATEGORY_ID"]');
            const options = await categorySelect.locator('option').all();
            let seoValue = null;
            for (const option of options) {
                const text = await option.textContent();
                if (text && text.includes('Search Engine Optimization (SEO)')) {
                    seoValue = await option.getAttribute('value');
                    break;
                }
            }
            if (!seoValue) {
                this.log('Category "Search Engine Optimization (SEO)" not found in select options.', 'error', true);
                throw new Error('Category "Search Engine Optimization (SEO)" not found in select options.');
            }
            await categorySelect.selectOption(seoValue);

            // Step 5: Fill description
            this.log('[EVENT] Filling description textarea', 'detail', false);
            const descriptionTextarea = page.locator('textarea#DESCRIPTION[name="DESCRIPTION"]');
            await descriptionTextarea.fill(this.content.body || '');

            // Step 6: Tick checkbox AGREERULES
            this.log('[EVENT] Checking checkbox AGREERULES', 'detail', false);
            const agreeCheckbox = page.locator('input#AGREERULES[name="AGREERULES"]');
            await agreeCheckbox.check();

            // Step 7: Click submit button
            this.log('[EVENT] Clicking submit button', 'detail', false);
            const submitButton = page.locator('input[type="submit"][name="continue"]');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                submitButton.click()
            ]);

            // Step 8: Verify submission message
            this.log('[EVENT] Verifying submission confirmation message', 'detail', false);
            const confirmationSelector = 'td.colspan-2.msg, td[colspan="2"].msg';
            await page.waitForSelector(confirmationSelector, { timeout: 15000 });
            const confirmationText = await page.textContent(confirmationSelector);
            if (!confirmationText || !confirmationText.includes('Link submitted and awaiting approval')) {
                this.log('Submission confirmation message not found or incorrect.', 'error', true);
                throw new Error('Submission confirmation message not found or incorrect.');
            }
            this.log(`[SUCCESS] Submission confirmed: ${confirmationText}`, 'success', true);

            // Step 9: Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.', 'info', true);

            // Step 10: Upload screenshot to Cloudinary
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

            // Step 11: Log confirmation message to websocketLogger and console
            this.log(`[EVENT] Submission message: ${confirmationText}`, 'info', true);
            console.log(`[${this.requestId}] [GainWebAdapter] Submission message: ${confirmationText}`);

            // Clean up local screenshot file
            fs.unlinkSync(screenshotPath);

            return { success: true, message: confirmationText, screenshotUrl: cloudinaryUrl };

        } catch (error) {
            this.log(`[ERROR] GainWebAdapter error: ${error.message}`, 'error', true);

            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
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

export default GainWebAdapter; 