import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import BaseAdapter from '../BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ControlCAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.baseUrl = 'https://controlc.com';
        this.extensionPath = path.join(__dirname, '../../recaptcha-solver');
        this.browser = null;
        this.page = null;
    }

    async publish() {
        this.log(`Starting ControlC publication for ${this.website.url}`, 'info', true);

        try {
            // Determine content and format - prioritize markdown
            let content = '';
            let codeHighlighting = '0'; // Default to no highlighting
            
            if (this.content.markdown) {
                content = this.content.markdown;
                codeHighlighting = '1'; // Enable highlighting for markdown
                this.log('Using markdown content with code highlighting enabled', 'detail', false);
            } else if (this.content.body) {
                content = this.content.body;
                // Try to detect content type for syntax highlighting
                if (content.trim().startsWith('<') && content.trim().includes('>')) {
                    codeHighlighting = '1'; // Enable for HTML
                } else if (content.includes('function') || content.includes('console.log') || content.includes('=>')) {
                    codeHighlighting = '1'; // Enable for JavaScript
                } else if (content.includes('def ') || content.includes('import ')) {
                    codeHighlighting = '1'; // Enable for Python
                } else {
                    codeHighlighting = this.content.codeHighlighting || '0';
                }
            }

            if (!content) {
                throw new Error('No content provided for paste creation');
            }

            const pasteData = {
                title: this.content.title || 'Untitled Paste',
                content: content,
                password: '', // No password for SEO accessibility
                codeHighlighting: codeHighlighting,
                expiration: '0', // Never expire for SEO
                privacy: '0' // Public for SEO
            };

            this.log(`Creating paste with title: ${pasteData.title}`, 'detail', false);

            // Initialize browser with extension
            await this.init();

            // Submit the paste
            const result = await this.submitPaste(pasteData);

            if (result.success) {
                this.logPublicationSuccess(result.url);
                return { success: true, postUrl: result.url };
            } else {
                throw new Error(result.error || 'Paste creation failed');
            }

        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            return this.handleError(error, this.page, this.browser);
        } finally {
            await this.close();
        }
    }

    async init() {
        this.log('Initializing browser with CAPTCHA solver extension', 'detail', false);
        
        this.browser = await chromium.launchPersistentContext('', {
            headless: true, // Set to true for production
            args: [
                `--disable-extensions-except=${this.extensionPath}`,
                `--load-extension=${this.extensionPath}`,
            ],
        });

        this.page = this.browser.pages()[0] || (await this.browser.newPage());
        this.log('Browser initialized successfully', 'detail', false);
    }

    async humanDelay(min = 500, max = 1500) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await this.page.waitForTimeout(delay);
    }

    async fillField(selector, text) {
        await this.page.fill(selector, text);
        await this.humanDelay(100, 300);
    }

    async submitPaste(pasteData) {
        try {
            this.log('Navigating to ControlC...', 'detail', false);
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
            await this.humanDelay(1000, 2000);

            if (pasteData.title) {
                this.log('Entering title...', 'detail', false);
                await this.fillField('#paste_title', pasteData.title);
            }

            if (pasteData.content) {
                this.log('Entering content...', 'detail', false);
                await this.fillField('#input_text', pasteData.content);
            }

            if (pasteData.codeHighlighting) {
                this.log(`Setting code highlighting to: ${pasteData.codeHighlighting}`, 'detail', false);
                await this.page.selectOption('select[name="code"]', pasteData.codeHighlighting);
                await this.humanDelay(300, 600);
            }

            if (pasteData.expiration) {
                this.log(`Setting expiration to: ${pasteData.expiration} (0 = never)`, 'detail', false);
                await this.page.selectOption('select[name="expire"]', pasteData.expiration);
                await this.humanDelay(300, 600);
            }

            if (pasteData.privacy) {
                this.log(`Setting privacy to: ${pasteData.privacy} (0 = public)`, 'detail', false);
                await this.page.selectOption('select[name="private"]', pasteData.privacy);
                await this.humanDelay(300, 600);
            }

            this.log('Waiting for CAPTCHA to be solved by extension...', 'detail', false);
            await this.page.waitForSelector('input[type="submit"]', {
                state: 'visible',
                timeout: 120000,
            });

            await this.humanDelay(1000, 2000);

            this.log('Submitting paste...', 'detail', false);
            
            // Take screenshot before submission
            const beforeScreenshotPath = `${this.requestId}-controlc-before-submit.png`;
            await this.page.screenshot({ path: beforeScreenshotPath, fullPage: true });

            await this.page.click('input[type="submit"]');
            await this.page.waitForLoadState('networkidle');

            const finalUrl = this.page.url();

            // Take screenshot after submission
            const afterScreenshotPath = `${this.requestId}-controlc-after-submit.png`;
            await this.page.screenshot({ path: afterScreenshotPath, fullPage: true });

            try {
                const cloudinaryResult = await cloudinary.uploader.upload(afterScreenshotPath);
                fs.unlinkSync(beforeScreenshotPath);
                fs.unlinkSync(afterScreenshotPath);
                this.logScreenshotUploaded(cloudinaryResult.secure_url);
            } catch (uploadError) {
                this.log(`Screenshot upload failed: ${uploadError.message}`, 'warning', false);
            }

            if (finalUrl !== this.baseUrl && !finalUrl.includes('error')) {
                this.log(`Paste created successfully at: ${finalUrl}`, 'detail', false);
                return { success: true, url: finalUrl };
            } else {
                this.log('Submission failed or redirected to base URL', 'error', true);
                return { success: false, url: finalUrl };
            }

        } catch (err) {
            this.log(`Error during submission: ${err.message}`, 'error', true);
            return { success: false, error: err.message };
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.log('Browser closed', 'detail', false);
        }
    }
}

export default ControlCAdapter;
