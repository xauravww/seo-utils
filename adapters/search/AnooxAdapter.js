import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class AnooxAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submissionUrl = 'https://anoox.com/add_for_indexing_free.php';
    }

    async publish() {
        this.log(`Starting Anoox submission for ${this.website.url}`, 'info', true);
        let browser, context, page;

        try {
            // Launch browser
            browser = await chromium.launch({
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            context = await browser.newContext();
            page = await context.newPage();

            // Extract email and URL - simple approach
            const email = this.content.email;
            const url = this.content.url;
            this.log(`Using email: ${email}`, 'detail', false);
            this.log(`Using URL: ${url}`, 'detail', false);

            // Step 1: Navigate to Anoox submission page
            this.log(`Navigating to: ${this.submissionUrl}`, 'detail', false);
            await page.goto(this.submissionUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Step 2: Fill the form
            try {
                this.log('Filling URL field...', 'detail', false);
                await page.waitForSelector('input[name="url"]', { timeout: 10000 });
                await page.fill('input[name="url"]', this.content.url);
                this.log(`URL filled: ${this.content.url}`, 'detail', false);

                this.log('Filling email field...', 'detail', false);
                await page.waitForSelector('input[name="email"]', { timeout: 10000 });
                await page.fill('input[name="email"]', email);
                this.log(`Email filled: ${email}`, 'detail', false);

                // Check the terms checkbox
                this.log('Checking terms checkbox...', 'detail', false);
                await page.waitForSelector('input[name="check_terms"]', { timeout: 10000 });
                await page.check('input[name="check_terms"]');
                this.log('Terms checkbox checked', 'detail', false);

            } catch (formError) {
                throw new Error(`Failed to fill form: ${formError.message}`);
            }

            // Step 3: Submit the form
            try {
                this.log('Submitting form...', 'detail', false);
                await page.click('input[name="submit"][value="Submit Site for Indexing"]');

                // Wait for response
                await page.waitForTimeout(3000);
                this.log('Form submitted, checking response...', 'detail', false);

            } catch (submitError) {
                throw new Error(`Failed to submit form: ${submitError.message}`);
            }

            // Step 4: Handle different response scenarios
            try {
                // Check if we need to resend confirmation
                const resendButton = await page.$('input[name="sub_re-send"]');
                if (resendButton) {
                    this.log('Found resend button, clicking to resend confirmation...', 'info', true);
                    await page.click('input[name="sub_re-send"]');
                    await page.waitForTimeout(2000);
                    this.log('Resend confirmation clicked', 'info', true);
                }

                // Check for success message
                const pageContent = await page.textContent('body');

                if (pageContent.includes('Good Job - Your Site with URL of:')) {
                    this.log('Success message detected - site submitted for indexing', 'info', true);
                } else if (pageContent.includes('has sucessfully been submitted to Anoox')) {
                    this.log('Site successfully submitted to Anoox for indexing', 'info', true);
                } else if (pageContent.includes('waiting your Confirmation')) {
                    this.log('Site submitted - waiting for email confirmation', 'info', true);
                } else if (pageContent.includes('just sent site confirmation') || pageContent.includes('just sent site confimation')) {
                    this.log('Site confirmation email just sent - check your email to confirm', 'info', true);
                } else if (pageContent.includes('You have already Submitted the Web site of:')) {
                    this.log('Site already submitted to Anoox previously - no action needed', 'info', true);
                } else if (pageContent.includes('have already provided its Meta data')) {
                    this.log('Site already submitted and metadata provided - no action needed', 'info', true);
                } else {
                    this.log('Form submitted - response unclear, check screenshot', 'warning', true);
                }

            } catch (responseError) {
                this.log(`Warning: Could not parse response: ${responseError.message}`, 'warning', true);
            }

            // Step 5: Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-anoox-screenshot.png`;
                await page.screenshot({
                    path: screenshotPath,
                    fullPage: true
                });

                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                screenshotUrl = cloudinaryResult.secure_url;
                this.logScreenshotUploaded(screenshotUrl);
            } catch (screenshotError) {
                this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
            }

            // Keep browser open briefly to see result
            await page.waitForTimeout(3000);

            const finalUrl = page.url();
            this.logPublicationSuccess(finalUrl);

            return {
                success: true,
                postUrl: finalUrl,
                screenshotUrl: screenshotUrl,
                message: "Site submitted to Anoox for indexing"
            };

        } catch (error) {
            this.log(`Anoox submission failed: ${error.message}`, 'error', true);

            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-anoox-error.png`;
                    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                    const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                    fs.unlinkSync(errorScreenshotPath);
                    this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                } catch (screenshotError) {
                    this.log(`Could not take error screenshot: ${screenshotError.message}`, 'warning', true);
                }
            }

            return {
                success: false,
                error: error.message,
                postUrl: null,
                screenshotUrl: null
            };
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    this.log(`Warning: Could not close browser: ${closeError.message}`, 'warning', true);
                }
            }
        }
    }
}

export default AnooxAdapter;