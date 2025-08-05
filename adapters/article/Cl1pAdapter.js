import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class Cl1pAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.baseUrl = 'https://cl1p.net';
        this.browser = null;
        this.page = null;
    }

    async publish() {
        this.log(`Starting Cl1p publication for ${this.website.url}`, 'info', true);

        try {
            // Determine content - prioritize markdown
            let content = '';
            
            if (this.content.markdown) {
                content = this.content.markdown;
                this.log('Using markdown content', 'detail', false);
            } else if (this.content.body) {
                content = this.content.body;
                this.log('Using body content', 'detail', false);
            }

            if (!content) {
                throw new Error('No content provided for paste creation');
            }

            this.log(`Creating cl1p with content length: ${content.length}`, 'detail', false);

            // Create the cl1p
            const result = await this.createCl1p(content);

            if (result.success) {
                this.logPublicationSuccess(result.url);
                return { success: true, postUrl: result.url };
            } else {
                throw new Error(result.error || 'Cl1p creation failed');
            }

        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            return this.handleError(error, this.page, this.browser);
        } finally {
            await this.close();
        }
    }

    // Generate random ID without crypto
    generateRandomId(length = 16) {
        const chars = "0123456789abcdef";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async createCl1p(content) {
        try {
            // Launch browser
            this.browser = await chromium.launch({ 
                headless: true // Set to true for production
            });
            this.page = await this.browser.newPage();

            // Generate random ID for SEO-friendly URL
            const randomId = this.generateRandomId();
            const url = `${this.baseUrl}/${randomId}`;

            this.log(`Navigating to: ${url}`, 'detail', false);

            // Go to generated URL
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });

            // Wait for textarea to load
            await this.page.waitForSelector('#cl1pTextArea');
            this.log('Textarea loaded successfully', 'detail', false);

            // Type content into the textarea
            await this.page.fill('#cl1pTextArea', content);
            this.log('Content filled into textarea', 'detail', false);

            // Set the TTL to maximum available time for SEO longevity
            // Check available options and use the longest one
            const ttlOptions = await this.page.$$eval('#ttlMain option', options => 
                options.map(option => ({ value: option.value, text: option.textContent }))
            );
            
            // Find the longest TTL option (usually the highest numeric value)
            const longestTTL = ttlOptions.reduce((max, option) => {
                const value = parseInt(option.value);
                return value > parseInt(max.value) ? option : max;
            }, { value: '0', text: 'Unknown' });

            await this.page.selectOption('#ttlMain', longestTTL.value);
            this.log(`Set TTL to: ${longestTTL.text} (value: ${longestTTL.value})`, 'detail', false);

            // Take screenshot before submission
            const beforeScreenshotPath = `${this.requestId}-cl1p-before-submit.png`;
            await this.page.screenshot({ path: beforeScreenshotPath, fullPage: true });

            // Click submit (using bottom button as it's more reliable)
            await Promise.all([
                this.page.waitForNavigation(),
                this.page.click('#createBtnBottom'),
            ]);

            // Take screenshot after submission
            const afterScreenshotPath = `${this.requestId}-cl1p-after-submit.png`;
            await this.page.screenshot({ path: afterScreenshotPath, fullPage: true });

            try {
                const cloudinaryResult = await cloudinary.uploader.upload(afterScreenshotPath);
                fs.unlinkSync(beforeScreenshotPath);
                fs.unlinkSync(afterScreenshotPath);
                this.logScreenshotUploaded(cloudinaryResult.secure_url);
            } catch (uploadError) {
                this.log(`Screenshot upload failed: ${uploadError.message}`, 'warning', false);
            }

            this.log(`Cl1p created successfully at: ${url}`, 'detail', false);
            return { success: true, url: url };

        } catch (error) {
            this.log(`Error creating cl1p: ${error.message}`, 'error', true);
            return { success: false, error: error.message };
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.log('Browser closed', 'detail', false);
        }
    }
}

export default Cl1pAdapter;
