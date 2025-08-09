import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';

class WriteAsAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://write.as/new";
    }

    async publish() {
        let browser, page;
        
        try {
            this.log('Starting WriteAs (write.as) publication', 'info', true);
            
            // Launch browser
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
            });
            page = await browser.newPage();

            // Extract content
            let content;
            try {
                content = this.content.body || this.content.html || this.content.markdown;
                
                if (!content) {
                    throw new Error('Content is required for write.as publication');
                }

                // If we have a title, prepend it to the content
                if (this.content.title) {
                    content = `# ${this.content.title}\n\n${content}`;
                }

                this.log(`Content prepared (${content.length} characters)`, 'detail', false);

            } catch (extractError) {
                throw new Error(`Failed to extract content: ${extractError.message}`);
            }

            // Step 1: Navigate to write.as
            this.log('Navigating to write.as...', 'detail', false);
            
            try {
                await page.goto(this.baseUrl, { 
                    waitUntil: "networkidle",
                    timeout: 30000 
                });
                
                // Wait for the page to load
                await page.waitForTimeout(2000);
                this.log('Successfully navigated to write.as', 'detail', false);
            } catch (navError) {
                throw new Error(`Navigation failed: ${navError.message}`);
            }

            // Step 2: Fill the content
            try {
                this.log('Looking for textarea with id "writer"...', 'detail', false);
                await page.waitForSelector("#writer", { timeout: 10000 });

                // Clear any existing content and fill with new content
                await page.click("#writer");
                await page.keyboard.down("Control");
                await page.keyboard.press("KeyA");
                await page.keyboard.up("Control");
                await page.keyboard.type(content);
                
                this.log("Content filled in textarea#writer successfully", 'info', true);

                // Wait a moment for content to be processed
                await page.waitForTimeout(2000);
            } catch (fillError) {
                throw new Error(`Failed to fill content: ${fillError.message}`);
            }

            // Step 3: Publish the content
            try {
                this.log("Waiting for publish button to be enabled...", 'detail', false);
                
                // Wait for the button to exist and not be disabled
                await page.waitForSelector("#publish:not([disabled])", { timeout: 15000 });

                // Click the publish button directly
                await page.click("#publish");
                this.log("Publish button clicked successfully", 'info', true);

                // Wait for potential redirect or confirmation
                await page.waitForTimeout(3000);
            } catch (publishError) {
                throw new Error(`Failed to publish: ${publishError.message}`);
            }

            // Step 4: Get results
            const currentUrl = page.url();
            this.log(`Current URL after publish attempt: ${currentUrl}`, 'detail', false);

            // Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-writeas-screenshot.png`;
                await page.screenshot({
                    path: screenshotPath,
                    fullPage: true,
                });

                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                screenshotUrl = cloudinaryResult.secure_url;
                this.logScreenshotUploaded(screenshotUrl);
            } catch (screenshotError) {
                this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
            }

            // Keep browser open for a few seconds to see the result
            await page.waitForTimeout(5000);

            this.logPublicationSuccess(currentUrl);

            return {
                success: true,
                postUrl: currentUrl,
                screenshotUrl: screenshotUrl,
                message: "Blog post published successfully"
            };

        } catch (error) {
            this.log(`Writeas (write.as) publication failed: ${error.message}`, 'error', true);
            
            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-writeas-error.png`;
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

export default WriteAsAdapter;