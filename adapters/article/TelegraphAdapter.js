import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';

class TelegraphAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://telegra.ph";
    }

    // Convert markdown to basic HTML (same as WordPressAdapter)
    static toBasicHtml(input) {
        if (!input) return '';
        let html = input;

        // Basic Markdown to HTML conversion
        // Headings
        html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
            .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
            .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
            .replace(/^### (.*)$/gm, '<h3>$1</h3>')
            .replace(/^## (.*)$/gm, '<h2>$1</h2>')
            .replace(/^# (.*)$/gm, '<h1>$1</h1>');

        // Bold **text** or __text__
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>');

        // Italic *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>');

        // Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>');

        // Unordered lists
        html = html.replace(/^[\*\-\+] (.*)$/gm, '<li>$1</li>');

        // Paragraphs (double newlines)
        html = html.replace(/\n{2,}/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, '');

        return html;
    }

    async publish() {
        let browser, page;

        try {
            this.log('Starting Telegraph publication', 'info', true);

            // Launch browser
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
            });
            page = await browser.newPage();

            // Extract content
            let title, content, author, htmlContent;
            try {
                title = this.content.title || 'Untitled Article';
                content = this.content.body || this.content.html || this.content.markdown;
                author = this.content.author || 'Anonymous';

                if (!content) {
                    throw new Error('Content is required for Telegraph publication');
                }

                // Convert markdown to HTML
                htmlContent = TelegraphAdapter.toBasicHtml(content);
                this.log(`Content prepared: title="${title}", author="${author}", HTML length=${htmlContent.length}`, 'detail', false);

            } catch (extractError) {
                throw new Error(`Failed to extract content: ${extractError.message}`);
            }

            // Step 1: Navigate to Telegraph
            this.log('Navigating to Telegraph...', 'detail', false);

            try {
                await page.goto(this.baseUrl, {
                    waitUntil: "networkidle",
                    timeout: 30000
                });

                await page.waitForTimeout(2000);
                this.log('Successfully navigated to Telegraph', 'detail', false);
            } catch (navError) {
                throw new Error(`Navigation failed: ${navError.message}`);
            }

            // Step 2: Fill the title
            try {
                this.log('Filling title...', 'detail', false);
                await page.waitForSelector('h1[data-label="Title"]', { timeout: 10000 });
                await page.click('h1[data-label="Title"]');
                await page.keyboard.type(title);
                this.log(`Title filled: "${title}"`, 'detail', false);
                await page.waitForTimeout(500);
            } catch (titleError) {
                throw new Error(`Failed to fill title: ${titleError.message}`);
            }

            // Step 3: Fill the author
            try {
                this.log('Filling author...', 'detail', false);
                await page.waitForSelector('address[data-label="Author"]', { timeout: 5000 });
                await page.click('address[data-label="Author"]');
                await page.keyboard.type(author);
                this.log(`Author filled: "${author}"`, 'detail', false);
                await page.waitForTimeout(500);
            } catch (authorError) {
                this.log(`Warning: Could not fill author field: ${authorError.message}`, 'warning', true);
            }

            // Step 4: Fill the content using innerHTML (simple approach)
            try {
                this.log('Filling content with HTML...', 'detail', false);
                await page.waitForSelector('p[data-placeholder="Your story..."]', { timeout: 10000 });

                // Use innerHTML to insert the HTML content directly
                await page.evaluate((htmlContent) => {
                    const contentElement = document.querySelector('p[data-placeholder="Your story..."]');
                    if (contentElement) {
                        contentElement.innerHTML = htmlContent;
                    }
                }, htmlContent);

                this.log(`Content filled with HTML (${htmlContent.length} characters)`, 'info', true);
                await page.waitForTimeout(1000);
            } catch (contentError) {
                throw new Error(`Failed to fill content: ${contentError.message}`);
            }

            // Step 5: Publish the article
            try {
                this.log('Publishing article...', 'detail', false);
                await page.waitForSelector('#_publish_button', { timeout: 10000 });
                await page.click('#_publish_button');
                this.log('Publish button clicked successfully', 'info', true);

                // Wait for the page to process and potentially redirect
                await page.waitForTimeout(5000);

                const currentUrl = page.url();
                this.log(`Current URL after publish: ${currentUrl}`, 'detail', false);

            } catch (publishError) {
                throw new Error(`Failed to publish: ${publishError.message}`);
            }

            // Step 6: Get results and take screenshot
            const finalUrl = page.url();

            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-telegraph-screenshot.png`;
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

            await page.waitForTimeout(3000);

            this.logPublicationSuccess(finalUrl);

            return {
                success: true,
                postUrl: finalUrl,
                screenshotUrl: screenshotUrl,
                message: "Telegraph article published successfully"
            };

        } catch (error) {
            this.log(`Telegraph publication failed: ${error.message}`, 'error', true);

            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-telegraph-error.png`;
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

export default TelegraphAdapter;