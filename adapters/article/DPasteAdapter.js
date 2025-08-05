import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class DPasteAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.baseUrl = 'https://dpaste.org';
    }

    async publish() {
        this.log(`Starting DPaste publication for ${this.website.url}`, 'info', true);
        
        let browser;
        let page;

        try {
            // Determine content and format - prioritize markdown
            let content = '';
            let lexer = '_text'; // Default to plain text
            
            if (this.content.markdown) {
                content = this.content.markdown;
                lexer = '_markdown';
                this.log('Using markdown content with markdown syntax highlighting', 'detail', false);
            } else if (this.content.body) {
                content = this.content.body;
                // Try to detect content type for syntax highlighting
                if (content.trim().startsWith('<') && content.trim().includes('>')) {
                    lexer = 'html';
                } else if (content.includes('function') || content.includes('console.log') || content.includes('=>')) {
                    lexer = 'js'; // Use 'js' instead of 'javascript'
                } else if (content.includes('def ') || content.includes('import ')) {
                    lexer = 'python';
                } else {
                    lexer = this.content.format || '_text';
                }
            }

            if (!content) {
                throw new Error('No content provided for paste creation');
            }

            this.log(`Creating paste with lexer: ${lexer}`, 'detail', false);

            // Launch browser
            browser = await chromium.launch({
                headless: true,
                // Use default chromium instead of chrome for better compatibility
            });

            page = await browser.newPage();
            
            // Navigate to dpaste.org
            await page.goto(this.baseUrl);
            this.log('Navigated to dpaste.org', 'detail', false);

            // Select syntax highlighting
            await page.selectOption('#id_lexer', lexer);
            this.log(`Selected lexer: ${lexer}`, 'detail', false);

            // Set expiry to never expire
            await page.selectOption('#id_expires', 'never');
            this.log('Set expiry to never expire', 'detail', false);

            // Fill content
            await page.fill('#id_content', content);
            this.log('Filled content into paste form', 'detail', false);

            // Submit the form and wait for navigation
            await Promise.all([
                page.waitForNavigation(),
                page.click('button[type="submit"]'),
            ]);

            const pasteUrl = page.url();
            this.log(`Paste created successfully at: ${pasteUrl}`, 'detail', false);

            // Take screenshot for verification
            const screenshotPath = `${this.requestId}-dpaste-screenshot.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            
            try {
                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                this.logScreenshotUploaded(cloudinaryResult.secure_url);
            } catch (uploadError) {
                this.log(`Screenshot upload failed: ${uploadError.message}`, 'warning', false);
            }

            await browser.close();

            this.logPublicationSuccess(pasteUrl);
            return { success: true, postUrl: pasteUrl };

        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            return this.handleError(error, page, browser);
        }
    }
}

export default DPasteAdapter;
