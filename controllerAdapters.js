import dotenv from 'dotenv';
dotenv.config();
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
chromium.use(StealthPlugin())
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import * as websocketLogger from './websocketLogger.js';
import { getControllerForWebsite } from './websiteClassifier.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cloudinary from 'cloudinary';
import fs from 'fs';

import { getRedditAccessToken, submitRedditPost } from './controllers/redditController.js';
import { sendTweet } from './controllers/social_media/twitterController.js';
import { postToFacebook } from './controllers/social_media/facebookController.js';
import { postToInstagram } from './controllers/social_media/instagramController.js';
import { UBookmarkingAdapter } from './controllers/bookmarking/ubookmarkingController.js';
import { OAuth } from 'oauth';
import { createClient } from 'redis';
import TurnstileBypass from 'turnstile-bypass';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('[controllerAdapters.js] REDIS_HOST:', process.env.REDIS_HOST);
const redisPublisher = createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});
redisPublisher.on('error', (err) => {
  console.error('[controllerAdapters.js][REDIS ERROR]', err);
});
await redisPublisher.connect();

function publishLog(requestId, message, level = 'info') {
    const payload = JSON.stringify({ message, level, timestamp: new Date().toISOString() });
    redisPublisher.publish(`logs:${requestId}`, payload);
}

// --- Base Adapter Class (for potential future extension) ---
class BaseAdapter {
    constructor({ requestId, website, content, job }) {
        this.requestId = requestId;
        this.website = website; // Contains url, category, and credentials
        this.content = content;
        this.category = website.category; // Store category directly for easy access
        this.collectedLogs = []; // Array to store logs for this specific adapter instance
        this.job = job; // BullMQ job instance, if provided
    }

    log(message, level = 'detail', isProductionLog = false) {
        // Add a prefix to distinguish logs from different adapters
        const formattedMessage = `[${this.constructor.name}] ${message}`;
        // Store log message and level internally
        this.collectedLogs.push({ message: formattedMessage, level: level });

        // Only send to websocketLogger if isProductionLog is true OR if not in production environment
        if (isProductionLog || process.env.NODE_ENV !== 'production') {
            publishLog(this.requestId, formattedMessage, level);
        }
        if (this.job && typeof this.job.log === 'function') {
            this.job.log(formattedMessage);
        }
    }

    // New method to retrieve collected logs
    getCollectedLogs() {
        if (process.env.NODE_ENV === 'production') {
            // Only return important logs in production
            return this.collectedLogs.filter(log =>
                ['info', 'success', 'warning', 'error'].includes(log.level)
            );
        }
        // In non-production, return all logs
        return this.collectedLogs;
    }

    async publish() {
        throw new Error('Publish method not implemented!');
    }

    // Helper to ensure BullMQ marks job as failed on error
    handleError(error, page, browser) {
        this.log(`[ERROR] ${this.constructor.name} error: ${error.message}`, 'error', true);
        return (async () => {
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true }).catch(() => { });
                try {
                    const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                    fs.unlinkSync(errorScreenshotPath);
                    this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                } catch { }
            }
            if (browser) await browser.close().catch(() => { });
            // Rethrow to let BullMQ mark as failed
            throw error;
        })();
    }
}



// --- WordPress Adapter ---
class WordPressAdapter extends BaseAdapter {
    // Helper to convert markdown to basic HTML, then allow only certain tags
    static toBasicHtml(input) {
        if (!input) return '';
        let html = input;
        // --- Basic Markdown to HTML conversion ---
        // Headings
        html = html.replace(/^###### (.*)$/gm, '<strong><em>$1</em></strong>')
            .replace(/^##### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^#### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^## (.*)$/gm, '<strong>$1</strong>')
            .replace(/^# (.*)$/gm, '<strong>$1</strong>');
        // Bold **text** or __text__
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>');
        // Italic *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>');
        // Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // Unordered lists
        html = html.replace(/^[\*\-\+] (.*)$/gm, '<br/>&nbsp;&nbsp;• $1');
        // Paragraphs (double newlines)
        html = html.replace(/\n{2,}/g, '<br/><br/>');
        // Inline code (not allowed, so escape)
        html = html.replace(/`([^`]+)`/g, '&lt;code&gt;$1&lt;/code&gt;');
        // --- End Markdown to HTML ---
        // Now escape all < and >
        let safe = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Unescape allowed tags
        safe = safe.replace(/&lt;a ([^&]*)&gt;/gi, '<a $1>')
            .replace(/&lt;\/a&gt;/gi, '</a>');
        safe = safe.replace(/&lt;strong&gt;/gi, '<strong>')
            .replace(/&lt;\/strong&gt;/gi, '</strong>');
        safe = safe.replace(/&lt;em&gt;/gi, '<em>')
            .replace(/&lt;\/em&gt;/gi, '</em>');
        safe = safe.replace(/&lt;!--more--&gt;/gi, '<!--more-->');
        safe = safe.replace(/&amp;nbsp;/gi, '&nbsp;');
        safe = safe.replace(/&lt;br\/?&gt;/gi, '<br/>');
        return safe;
    }

    async loginAndExtract() {
        let browser;
        this.log(`Launching browser for login at ${this.website.url}`, 'detail', false);
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({ ignoreHTTPSErrors: true });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Construct the standard WordPress login URL and navigate there directly.
            const loginUrl = `${this.website.url.replace(/\/$/, '')}/login`;
            this.log(`Navigating to login page: ${loginUrl}`, 'detail', false);
            await page.goto(loginUrl, { waitUntil: 'networkidle' });

            // Add the user's provided selectors to make the locator more robust.
            const usernameLocator = page.locator('input[name="username"], input[name="user_login"], input[name="log"], input[name="usr"]');
            const passwordLocator = page.locator('input[name="password"], input[name="user_pass"], input[name="pwd"], input[name="pass"]');
            // Use credentials from the website object
            await usernameLocator.fill(this.website.credentials.username);
            await passwordLocator.fill(this.website.credentials.password);

            this.log('Credentials filled. Clicking submit...', 'detail', false);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle' }),
                page.click('input[type="submit"], button[type="submit"], #wp-submit')
            ]);

            const newPostUrl = `${this.website.url.replace(/\/$/, '')}/new-post`;
            this.log(`Logged in. Navigating to new post page: ${newPostUrl}`, 'detail', false);
            await page.goto(newPostUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('form[id="post"]', { timeout: 15000 });

            const cookies = await context.cookies();
            const hiddenInputs = await page.$$eval('form[id="post"] input[type="hidden"]', inputs =>
                inputs.reduce((obj, el) => {
                    obj[el.name] = el.value;
                    return obj;
                }, {})
            );

            this.log(`Extracted ${cookies.length} cookies and ${Object.keys(hiddenInputs).length} hidden inputs.`, 'info', false);
            return { cookies, hiddenInputs, newPostUrl };
        } finally {
            if (browser) {
                await browser.close();
                this.log(`Browser closed after extraction.`, 'detail', false);
            }
        }
    }

    async postWithAxios(cookies, hiddenInputs, newPostUrl) {
        this.log('Posting article with extracted session data...', 'detail', false);
        const jar = new CookieJar();
        for (const cookie of cookies) {
            const url = `https://${cookie.domain.replace(/\/$/, '')}`;
            await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
        }

        const client = wrapper(axios.create({ jar }));

        // Convert content.body to basic HTML
        const htmlBody = WordPressAdapter.toBasicHtml(this.content.body);
        const form = { ...hiddenInputs, post_title: this.content.title, content: htmlBody, publish: 'Publish' };
        const body = new URLSearchParams(form).toString();

        const postRes = await client.post(newPostUrl, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const $ = load(postRes.data);
        // Extract post URL from response
        let postUrl = $('#successfully_posted_url a').attr('href');
        if (!postUrl) {
            postUrl = $('#published-url a').attr('href');
        }

        if (!postUrl) {
            this.log('Failed to find post URL in response. The page HTML will be logged for debugging.', 'error', true);
            throw new Error('Could not find the final post URL in the response page. Check logs for HTML snippet.');
        }

        const successMessage = `Successfully extracted post URL: ${postUrl}`;
        this.log(successMessage, 'success', true);
        console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
        return postUrl;
    }

    async publish() {
        this.log(`Starting WordPress publication for ${this.website.url}`, 'info', true);
        try {
            const { cookies, hiddenInputs, newPostUrl } = await this.loginAndExtract();
            const postUrl = await this.postWithAxios(cookies, hiddenInputs, newPostUrl);
            const successMessage = `Publication successful! URL: ${postUrl}`;
            this.log(successMessage, 'success', true);
            console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
            return { success: true, postUrl };
        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            console.error(`[${this.requestId}] [WordPressAdapter] Publication failed for ${this.website.url}:`, error.message);
            throw error;
        }
    }
}

// --- PingMyLinks Adapter ---
class PingMyLinksAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        // Map categories to their respective PingMyLinks submission URLs
        this.pingUrls = {
            'pingmylinks/googleping': 'https://www.pingmylinks.com/googleping/',
            'pingmylinks/searchsubmission': 'https://www.pingmylinks.com/addurl/searchsubmission/',
            'pingmylinks/socialsubmission': 'https://www.pingmylinks.com/addurl/socialsubmission/',
        };

    }

    async publish() {
        this.log('[EVENT] Entering PingMyLinksAdapter publish method.', 'info', true);

        // Determine the target PingMyLinks URL based on the name
        const targetPingUrl = this.pingUrls[this.website.name];
        if (!targetPingUrl) {
            throw new Error(`Unsupported PingMyLinks name: ${this.website.name}`);
        }

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...', 'detail', false);
            browser = await chromium.launch({ headless: true }); // Changed to headless: true for debugging
            this.log('[DEBUG] chromium.launch() completed.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to target page: ${targetPingUrl}`, 'detail', false);
            await page.goto(targetPingUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            this.log('[EVENT] Setting up page event listeners.', 'detail', false);
            page.on('request', request => {
                let curlCommand = `curl \'${request.url()}\'`
                curlCommand += ` -X ${request.method()}`;
                const headers = request.headers();
                for (const key in headers) {
                    const value = headers[key].replace(/'/g, "'\\''");
                    curlCommand += ` -H \'${key}: ${value}\'`
                }
                const postData = request.postData();
                if (postData) {
                    curlCommand += ` --data-raw \'${postData}\'`
                    const urlMatch = postData.match(/(?:^|&)u=([^&]*)/);
                    if (urlMatch && urlMatch[1]) {
                        const pingedUrl = decodeURIComponent(urlMatch[1]);
                    }
                }
            });

            page.on('response', async response => {
                if (response.url().includes('api.php')) {
                    try {
                        const responseBody = await response.text();
                        this.log(`Successfully pinged to this website: ${responseBody}`, 'success', true);
                        console.log(`Successfully pinged to this website: ${responseBody}`);
                    } catch (e) {
                        this.log(`Error reading API.PHP response body: ${e.message}`, 'error', true);
                        console.error(`Error reading API.PHP response body: ${e.message}`);
                    }
                }
            });

            page.on('pageerror', error => {
            });

            page.on('console', msg => {
            });

            // START: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC
            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const furlInput = page.locator('#furl');
            try {
                await furlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                // Use the user's public_website_1 if available, otherwise fallback to this.website.url
                let urlToPing = null;
                if (this.content && this.content.url) {
                    urlToPing = this.content.url;
                } else {
                    urlToPing = this.website.url;
                }
                await furlInput.fill(urlToPing);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-furl-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-furl-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('.frmSubmit[type="button"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submit-button-error-screenshot.png`, 'info', true);
                }
                throw error;
            }
            // END: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC

            this.log('[EVENT] Waiting for submission completion message (indefinitely)...', 'detail', false);
            const successMessageSelector = 'div.messageok';
            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 0 });
                const messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Submission Complete!')) {
                    this.log(`[SUCCESS] Submission Complete! Message: ${messageText}`, 'success', true);
                } else {
                    this.log(`[WARNING] Submission Complete message found, but text is not as expected: ${messageText}`, 'warning', true);
                }
            } catch (error) {
                this.log(`[ERROR] Failed to find submission complete message: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submission-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submission-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[SUCCESS] Script finished successfully.', 'success', true);
            return { success: true };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
            this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
            this.log('----------------------', 'error', true);
            this.log('[EVENT] An error occurred.', 'error', true);
            throw error;
        } finally {
            if (browser) {
                if (page) {
                    const screenshotCompletionPath = `screenshot_completion_${this.requestId}.png`;
                    await page.screenshot({ path: screenshotCompletionPath, fullPage: true });
                    this.log('[EVENT] Screenshot taken after completion.', 'info', true);

                    const cloudinaryUploadCompletionResult = await cloudinary.uploader.upload(screenshotCompletionPath);
                    this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`, 'info', true);
                    console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`);

                    fs.unlinkSync(screenshotCompletionPath);
                } else {
                    this.log('[EVENT] Page instance was not created, skipping completion screenshot.', 'warning', true);
                }

                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

// --- SecretSearchEngineLabs Adapter ---
class SecretSearchEngineLabsAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submissionUrl = 'http://www.secretsearchenginelabs.com/add-url.php';
    }

    async publish() {
        this.log(`[EVENT] Entering SecretSearchEngineLabsAdapter publish method for ${this.website.url}.`, 'info', true);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...', 'detail', false);
            browser = await chromium.launch({ headless: true }); // Changed to headless: true for debugging
            this.log('[DEBUG] chromium.launch() completed.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to submission page: ${this.submissionUrl}`, 'detail', false);
            await page.goto(this.submissionUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="newurl"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-url-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('input[type="submit"][value="Add URL"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submit-button-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[EVENT] Waiting for submission result message...', 'detail', false);
            // Check for success or already submitted message
            const successMessageSelector = 'body'; // The message is directly in the body as a <b> tag
            await page.waitForTimeout(3000); // Give some time for content to load after submission

            let successMessage = '';
            let cloudinaryUrl = '';

            try {
                const bodyContent = await page.textContent('body');
                if (bodyContent.includes('is already included in the index, no need to resubmit!')) {
                    successMessage = `URL ${this.website.url} is already included in the index, no need to resubmit!`;
                    this.log(`[INFO] ${successMessage}`, 'info', true);
                } else if (bodyContent.includes('URL added to queue!')) { // Assuming this is the success message
                    successMessage = `URL ${this.website.url} successfully added to queue!`;
                    this.log(`[SUCCESS] ${successMessage}`, 'success', true);
                } else {
                    successMessage = `Unknown submission result for ${this.website.url}. Body content: ${bodyContent.substring(0, 200)}...`;
                    this.log(`[WARNING] ${successMessage}`, 'warning', true);
                }

                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.', 'info', true);

                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

                fs.unlinkSync(screenshotPath);

            } catch (error) {
                this.log(`[ERROR] Failed to determine submission message or upload screenshot: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submission-result-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submission-result-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[SUCCESS] Script finished successfully.', 'success', true);
            return { success: true, message: successMessage, cloudinaryUrl: cloudinaryUrl };

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
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

// --- ActiveSearchResults Adapter ---
class ActiveSearchResultsAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submissionUrl = 'https://www.activesearchresults.com/addwebsite.php';
    }

    async publish() {
        this.log(`[EVENT] Entering ActiveSearchResultsAdapter publish method for ${this.website.url}.`, 'info', true);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...', 'detail', false);
            browser = await chromium.launch({ headless: true }); // Changed to headless: true for debugging
            this.log('[DEBUG] chromium.launch() completed.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to submission page: ${this.submissionUrl}`, 'detail', false);
            await page.goto(this.submissionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="url"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...', 'detail', false);
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-url-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[EVENT] Locating Email input field...', 'detail', false);
            const emailInput = page.locator('input[name="email"]');
            try {
                await emailInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling Email input field...', 'detail', false);
                await emailInput.fill(this.website.credentials.email);
                this.log('[EVENT] Email input field filled.', 'detail', false);
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill Email input field: ${error.message}`, 'error', true);
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-email-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-email-input-error-screenshot.png`, 'info', true);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('input[type="submit"][name="submiturl"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...', 'detail', false);
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.', 'detail', false);

                // Take a screenshot immediately after clicking the submit button for debugging
                const postSubmitScreenshotPath = `${this.requestId}-post-submit-screenshot.png`;
                await page.screenshot({ path: postSubmitScreenshotPath, fullPage: true });
                this.log(`[EVENT] Screenshot taken immediately after submit button click: ${postSubmitScreenshotPath}`, 'info', true);
                const cloudinaryPostSubmitUploadResult = await cloudinary.uploader.upload(postSubmitScreenshotPath);
                this.log(`[EVENT] Post-submit screenshot uploaded to Cloudinary: ${cloudinaryPostSubmitUploadResult.secure_url}`, 'info', true);
                fs.unlinkSync(postSubmitScreenshotPath);

                this.log('[EVENT] Waiting for success message to appear and taking screenshot...', 'detail', false);

                // Log the full page content for debugging
                const pageHtml = await page.content();
                this.log(`[DEBUG] Page HTML after submission: ${pageHtml.substring(0, 500)}...`, 'detail', false);

                // Wait for the success message to appear
                const successMessageSelector = 'h1';
                try {
                    await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                    const messageText = await page.textContent(successMessageSelector);
                    if (!messageText || !messageText.includes('Added Web Site Confirmation')) {
                        throw new Error('Success message not found or not as expected.');
                    }
                    this.log(`[INFO] Submission confirmation message: ${messageText}`, 'info', true);
                } catch (error) {
                    this.log(`[ERROR] Failed to find submission confirmation message: ${error.message}`, 'error', true);
                    if (page) {
                        await page.screenshot({ path: `${this.requestId}-activesearchresults-confirmation-error-screenshot.png` });
                        this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-confirmation-error-screenshot.png`, 'info', true);
                    }
                    throw error;
                }

                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.', 'info', true);

                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                const cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

                fs.unlinkSync(screenshotPath);

                this.log('[SUCCESS] Script finished successfully.', 'success', true);
                return { success: true, message: 'URL submitted and screenshot taken.', cloudinaryUrl: cloudinaryUrl };

            } catch (error) {
                this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
                this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
                this.log('----------------------', 'error', true);
                this.log('[EVENT] An error occurred.', 'error', true);
                throw error;
            }

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
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

// --- Reddit Adapter ---
class RedditAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering RedditAdapter publish method for ${this.website.url}.`, 'info', true);
        const { clientId, clientSecret, username, password, subreddit } = this.website.credentials;
        const { title, body } = this.content;

        if (!clientId || !clientSecret || !username || !password || !subreddit || !title || !body) {
            const errorMessage = 'Missing required Reddit credentials or content fields.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to get Reddit access token...', 'detail', false);
            const accessToken = await getRedditAccessToken(clientId, clientSecret, username, password);
            this.log('[SUCCESS] Access token obtained successfully.', 'success', true);

            this.log('[EVENT] Submitting post to Reddit...', 'detail', false);
            const postUrl = await submitRedditPost(accessToken, subreddit, title, body, username);

            this.log(`[SUCCESS] Reddit post created successfully! URL: ${postUrl}`, 'success', true);
            return { success: true, postUrl: postUrl };

        } catch (error) {
            this.log(`[ERROR] Reddit post creation failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

// --- Twitter Adapter ---
class TwitterAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering TwitterAdapter publish method.`, 'info', true);
        const { appKey, appSecret, accessToken, accessSecret } = this.website.credentials;
        const tweetText = this.content.body; // Assuming the tweet content is in content.body

        if (!appKey || !appSecret || !accessToken || !accessSecret || !tweetText) {
            const errorMessage = 'Missing required Twitter credentials or tweet text.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to send tweet...', 'detail', false);
            const tweetResult = await sendTweet({ appKey, appSecret, accessToken, accessSecret }, tweetText);

            if (tweetResult.success) {
                this.log(`[SUCCESS] Tweet posted successfully! URL: ${tweetResult.tweetUrl}`, 'success', true);
                return { success: true, tweetUrl: tweetResult.tweetUrl };
            } else {
                throw new Error(tweetResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Twitter post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

// --- Facebook Adapter ---
class FacebookAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering FacebookAdapter publish method.`, 'info', true);
        const { appId, appSecret, pageAccessToken, pageId } = this.website.credentials;
        const message = this.content.body; // Assuming the post content is in content.body

        if (!appId || !appSecret || !pageAccessToken || !pageId || !message) {
            const errorMessage = 'Missing required Facebook credentials or post message.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to post to Facebook...', 'detail', false);
            const facebookPostResult = await postToFacebook({ appId, appSecret, pageAccessToken, pageId }, message);

            if (facebookPostResult.success) {
                this.log(`[SUCCESS] Facebook post created successfully! URL: ${facebookPostResult.postUrl}`, 'success', true);
                return { success: true, postUrl: facebookPostResult.postUrl };
            } else {
                throw new Error(facebookPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Facebook post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

// --- Instagram Adapter ---
class InstagramAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering InstagramAdapter publish method.`, 'info', true);
        const { pageId, accessToken } = this.website.credentials;
        const { imageUrl, caption } = this.content; // Assuming content will have imageUrl and caption

        if (!pageId || !accessToken || !imageUrl || !caption) {
            const errorMessage = 'Missing required Instagram credentials or content fields (pageId, accessToken, imageUrl, caption).';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to post to Instagram...', 'detail', false);
            const instagramPostResult = await postToInstagram({ pageId, accessToken }, { imageUrl, caption });

            if (instagramPostResult.success) {
                this.log(`[SUCCESS] Instagram post created successfully! URL: ${instagramPostResult.postUrl}`, 'success', true);
                return { success: true, postUrl: instagramPostResult.postUrl };
            } else {
                throw new Error(instagramPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Instagram post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

// --- BookmarkZoo Adapter ---
class BookmarkZooAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://www.bookmarkzoo.win/pages/login';
        this.submitUrl = 'https://www.bookmarkzoo.win/pages/submit';
    }

    async publish() {
        this.log(`[EVENT] Entering BookmarkZooAdapter publish method.`, 'info', true);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...', 'detail', false);
            browser = await chromium.launch({ headless: true }); // Changed to headless: true for debugging
            this.log('[DEBUG] chromium.launch() completed.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(60000);

            // Step 1: Login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);

            this.log('[EVENT] Filling login form...', 'detail', false);
            await page.locator('input[name="username"]').fill(this.website.credentials.username);
            await page.locator('input[name="password"]').fill(this.website.credentials.password);
            await page.locator('input[name="captcha"]').fill('2'); // Captcha is always 2
            this.log('[EVENT] Login form filled. Clicking login button...', 'detail', false);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input[type="submit"][name="wp-submit"]').click()
            ]);
            this.log('[EVENT] Login successful.', 'detail', false);

            // Step 2: Navigate to submission page
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.', 'detail', false);

            this.log('[EVENT] Filling submission form...', 'detail', false);
            await page.locator('input[name="submit_url"]').fill(this.content.url || this.website.url, { timeout: 10000 });
            await page.locator('input[name="submit_title"]').fill(this.content.title, { timeout: 10000 });
            await page.locator('textarea[name="submit_body"]').fill(this.content.body, { timeout: 10000 });
            this.log('[EVENT] Submission form filled. Clicking submit button...', 'detail', false);

            // Step 4: Submit the bookmark
            await Promise.all([
                page.waitForResponse(response => response.url().includes('/submit') && response.status() === 200), // Wait for a successful response on submit
                page.locator('button[type="submit"][id="publish"]').click()
            ]);
            this.log('[EVENT] Submit button clicked. Waiting for success message.', 'detail', false);

            // Step 5: Extract the posted URL
            const successMessageSelector = 'div.alert.alert-success#msg-flash a';
            await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
            const postUrl = await page.getAttribute(successMessageSelector, 'href');

            if (!postUrl) {
                this.log('Could not extract the posted URL from the success message.', 'error', true);
                throw new Error('Could not extract the posted URL from the success message.');
            }
            this.log(`[SUCCESS] Bookmark posted successfully! URL: ${postUrl}`, 'success', true);

            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);

            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

            fs.unlinkSync(screenshotPath);

            return { success: true, postUrl: postUrl, cloudinaryUrl: cloudinaryUrl };

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
            }
            else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

// --- TeslaBookmarks & PearlBookmarking Unified Adapter ---
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

            // Step 1: Login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);

            this.log('[EVENT] Filling login form...', 'detail', false);
            const username = this.website.credentials.username;
            const password = this.website.credentials.password;
            // Fill login form for both sites
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

            // Step 2: Navigate to submission page
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.', 'detail', false);

            // Step 3: Fill submission form
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
            // Select correct category
            const categoryValue = this.website.url.includes('pearlbookmarking.com') ? '2152' : '87550';
            await page.locator('select[name="story_category"]').selectOption({ value: categoryValue });
            this.log('[EVENT] Submission form filled. Clicking submit button...', 'detail', false);

            // Step 4: Submit the story
            await page.locator('input[type="submit"][name="submit"]').click();
            await page.waitForTimeout(2000); // Wait for possible redirect
            const currentUrlCheck = page.url();

            // --- NEW: Immediately check for duplicate error or review/`story.php` URL ---
            // 1. Check for error message
            const errorDiv = await page.locator('div.alert.alert-danger').first();
            let errorText = null;
            if (await errorDiv.isVisible()) {
                errorText = await errorDiv.textContent();
                if (errorText && errorText.includes('The url is already been submitted, but this story is pending review')) {
                    // Take screenshot and return immediately
                    const reviewScreenshotPath = `review_screenshot_${this.requestId}.png`;
                    await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
                    this.log(`[EVENT] Bookmark is in review (duplicate detected). Screenshot taken.`, 'info', true);
                    const cloudinaryReviewUploadResult = await cloudinary.uploader.upload(reviewScreenshotPath);
                    const reviewCloudinaryUrl = cloudinaryReviewUploadResult.secure_url;
                    fs.unlinkSync(reviewScreenshotPath);
                    // Ensure browser is closed AFTER screenshot/upload
                    if (browser) { await browser.close(); this.log('[EVENT] Browser closed after execution.', 'detail', false); }
                    return { success: true, message: 'Bookmark is in review (duplicate detected).', reviewUrl: currentUrlCheck, reviewScreenshot: reviewCloudinaryUrl };
                }
            }
            // 2. Check for review/`story.php`-type URL
            if (currentUrlCheck.includes('story.php') || currentUrlCheck.startsWith(this.reviewUrl)) {
                const reviewScreenshotPath = `review_screenshot_${this.requestId}.png`;
                await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
                this.log(`[EVENT] Bookmark is in review. Redirected to: ${currentUrlCheck}`, 'info', true);
                this.log('[EVENT] Screenshot taken for review status.', 'info', true);
                const cloudinaryReviewUploadResult = await cloudinary.uploader.upload(reviewScreenshotPath);
                const reviewCloudinaryUrl = cloudinaryReviewUploadResult.secure_url;
                fs.unlinkSync(reviewScreenshotPath);
                // Ensure browser is closed AFTER screenshot/upload
                if (browser) { await browser.close(); this.log('[EVENT] Browser closed after execution.', 'detail', false); }
                return { success: true, message: 'Bookmark is in review.', reviewUrl: currentUrlCheck, reviewScreenshot: reviewCloudinaryUrl };
            }
            // --- END NEW LOGIC ---

            // If not review page, fallback to waiting for network response
            await page.waitForResponse(response => response.url().includes('/submit-story/') && response.status() === 200, { timeout: 10000 });
            this.log('[EVENT] Submit button clicked. Waiting for success message.', 'detail', false);

            // Step 5: Confirm submission and take final screenshot (fallback, rarely used)
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

// --- GainWeb Adapter ---
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
            // Find option with text containing "Search Engine Optimization (SEO)"
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
            console.error(`[${this.requestId}] [GainWebAdapter] Error: ${error.message}`);

            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                this.log(`[EVENT] Error screenshot taken: ${errorScreenshotPath}`, 'info', true);
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
                console.log(`[${this.requestId}] [GainWebAdapter] Error screenshot URL: ${errorCloudinaryResult.secure_url}`);
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

// --- SocialSubmissionEngine Adapter ---
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

// --- Dev.to Adapter ---
class DevToAdapter extends BaseAdapter {
    async publish() {
        this.log(`Starting Dev.to publication for ${this.website.url}`, 'info', true);
        const apiKey = this.website.credentials.devtoApiKey || this.website.credentials['devto-api-key'];
        if (!apiKey) {
            const errorMessage = 'Missing dev.to API key in credentials (devtoApiKey or devto-api-key).';
            this.log(errorMessage, 'error', true);
            throw error;
        }
        try {
            const articleData = {
                article: {
                    title: this.content.title || 'Untitled',
                    body_markdown: this.content.markdown || this.content.body || '',
                    published: true,
                    series: this.content.series || undefined,
                    main_image: this.content.main_image || undefined,
                    description: this.content.description || this.content.title || '',
                    tags: this.content.tags || '',
                    organization_id: this.content.organization_id || undefined
                }
            };
            const res = await axios.post('https://dev.to/api/articles', articleData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey
                }
            });
            const postUrl = res.data.url;
            this.log(`Dev.to post created: ${postUrl}`, 'success', true);
            return { success: true, postUrl };
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Dev.to post error: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw error;
        }
    }
}

// --- Hashnode Adapter ---
class HashnodeAdapter extends BaseAdapter {
    async publish() {
        this.log(`Starting Hashnode publication for ${this.website.url}`, 'info', true);
        const apiToken = this.website.credentials.hashnodeApiToken || this.website.credentials['hashnode-api-token'];
        const username = this.website.credentials.hashnodeUsername || this.website.credentials['hashnode-username'];
        if (!apiToken || !username) {
            const errorMessage = 'Missing Hashnode API token or username in credentials (hashnodeApiToken/hashnode-api-token, hashnodeUsername/hashnode-username).';
            this.log(errorMessage, 'error', true);
            throw error;
        }
        // Utility to slugify title
        function slugify(str) {
            return str.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-');
        }
        // Step 1: Get publicationId
        const pubQuery = `
            query PublicationInfo($host: String!) {
              publication(host: $host) {
                id
                title
                author { name username }
              }
            }
        `;
        let publicationId;
        try {
            const pubRes = await axios.post(
                'https://gql.hashnode.com/',
                {
                    query: pubQuery,
                    variables: { host: `${username}.hashnode.dev` }
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            const publication = pubRes.data.data.publication;
            if (!publication) {
                throw new Error('Publication not found');
            }
            publicationId = publication.id;
            this.log(`Found publication: ${publication.title}`, 'info', true);
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Failed to get publication ID: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw error;
        }
        // Step 2: Create post
        const postQuery = `
            mutation PublishPost($input: PublishPostInput!) {
              publishPost(input: $input) {
                post { url }
              }
            }
        `;
        const title = this.content.title || 'Untitled';
        const slug = slugify(title);
        const contentMarkdown = this.content.markdown || this.content.body || '# Hello Hashnode';
        const tags = this.content.tagsArray || this.content.tags || [];
        // tags: [{ id, name }] array or string
        let tagsArr = Array.isArray(tags) ? tags : [];
        if (typeof tags === 'string' && tags) {
            tagsArr = tags.split(',').map(t => ({ name: t.trim() }));
        }
        try {
            const postRes = await axios.post(
                'https://gql.hashnode.com/',
                {
                    query: postQuery,
                    variables: {
                        input: {
                            publicationId: publicationId,
                            title: title,
                            contentMarkdown: contentMarkdown,
                            tags: tagsArr
                        }
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            const post = postRes.data.data.publishPost.post;
            if (!post || !post.url) {
                throw new Error('No post URL returned');
            }
            this.log(`Hashnode post published: ${post.url}`, 'success', true);
            return { success: true, postUrl: post.url };
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Failed to publish post: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw error;
        }
    }
}

// --- Tumblr Adapter ---
class TumblrAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        // Expect credentials in this.website.credentials
        this.consumerKey = this.website.credentials.consumerKey;
        this.consumerSecret = this.website.credentials.consumerSecret;
        this.accessToken = this.website.credentials.accessToken;
        this.accessTokenSecret = this.website.credentials.accessTokenSecret;
        this.blogHostname = this.website.credentials.blogHostname; // e.g., 'myblog.tumblr.com'
    }

    async publish() {
        this.log(`[EVENT] Entering TumblrAdapter publish method for ${this.blogHostname}.`, 'info', true);
        if (!this.consumerKey || !this.consumerSecret || !this.accessToken || !this.accessTokenSecret || !this.blogHostname) {
            const errorMessage = 'Missing Tumblr credentials (consumerKey, consumerSecret, accessToken, accessTokenSecret, blogHostname).';
            this.log(errorMessage, 'error', true);
            throw error;
        }
        const oauth = new OAuth(
            'https://www.tumblr.com/oauth/request_token',
            'https://www.tumblr.com/oauth/access_token',
            this.consumerKey,
            this.consumerSecret,
            '1.0A',
            null,
            'HMAC-SHA1'
        );
        // Convert markdown to HTML for Tumblr
        let bodyContent = this.content.body || this.content.markdown || this.content.html || '';
        if (this.content.markdown) {
            // Basic markdown to HTML conversion (headings, bold, italic, links, line breaks)
            bodyContent = bodyContent
                .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
                .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
                .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
                .replace(/^### (.*)$/gm, '<h3>$1</h3>')
                .replace(/^## (.*)$/gm, '<h2>$1</h2>')
                .replace(/^# (.*)$/gm, '<h1>$1</h1>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.*?)__/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/_(.*?)_/g, '<em>$1</em>')
                .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>')
                .replace(/\n/g, '<br/>');
        }
        const postData = {
            type: 'text',
            title: this.content.title || 'Untitled',
            body: bodyContent
        };
        const url = `https://api.tumblr.com/v2/blog/${this.blogHostname}/post`;
        return new Promise((resolve) => {
            oauth.post(url, this.accessToken, this.accessTokenSecret, postData, (err, data) => {
                if (err) {
                    this.log('Failed to post to Tumblr: ' + JSON.stringify(err), 'error', true);
                    resolve({ success: false, error: err });
                } else {
                    this.log('Successfully created Tumblr post: ' + data, 'success', true);
                    // Try to extract the post URL from the response
                    let postUrl = null;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed.response && parsed.response.id && this.blogHostname) {
                            postUrl = `https://${this.blogHostname}/post/${parsed.response.id}`;
                        }
                    } catch (e) {
                        this.log('Failed to parse Tumblr response: ' + e.message, 'error', true);
                    }
                    resolve({ success: true, postUrl, response: data });
                }
            });
        });
    }
}

// --- Delphi Forum Adapter ---
class DelphiForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting Delphi forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title, body } = this.content;
        let browser;
        let page;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            page = await context.newPage();
            // Block unnecessary resources
            await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', (route) => route.abort());
            await page.route('**/*google-analytics.com*', (route) => route.abort());
            await page.route('**/*doubleclick.net*', (route) => route.abort());
            await page.route('**/*twitter.com*', (route) => route.abort());
            // Login
            await page.goto('https://secure.delphiforums.com/n/login/login.aspx?webtag=dflogin&seamlesswebtag=https%3a%2f%2fdelphiforums.com%2f%3fredirCnt%3d1', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.locator('#lgnForm_username').fill(username);
            await page.locator('#lgnForm_password').fill(password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.locator('#df_lgnbtn').click()
            ]);
            // Go to forum
            await page.goto('https://forums.delphiforums.com/opinionpolls', { waitUntil: 'domcontentloaded', timeout: 30000 });
            // New topic
            await page.locator('#df_mainstream > div.df-contenthead.df-ch-feed.df-xshide > button.btn.btn-primary.pull-right.df-mainnav.df-new.df-full').click();
            await page.locator('#msg_subject').fill(title);
            //select folder here
            await page.locator('#msg_folderId').selectOption({ value: '10' });
            await page.locator('#cke_1_contents > div').click();
            await page.locator('#cke_1_contents > div').fill(body);
            // Click the 'Post' button by its text
            const postButton = await page.getByRole('button', { name: /Post/i });
            await Promise.all([
                postButton.click(),
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
            ]);
            const finalUrl = await page.url();
            // Screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log('Cloudinary config at upload:', cloudinary.config());
            console.log('Uploading file:', screenshotPath, 'Exists:', fs.existsSync(screenshotPath));
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            this.log(`[SUCCESS] Delphi forum post created: ${finalUrl}`, 'success', true);
            this.log(`[SCREENSHOT] Screenshot uploaded: ${cloudinaryUrl}`, 'info', true);
            return { success: true, postUrl: finalUrl, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] DelphiForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

// --- City-Data Forum Adapter ---
class CityDataForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting City-Data forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title, body } = this.content;
        let browser;
        let page;
        try {
            browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            page = await context.newPage();
            await page.route('**/*google-analytics.com*', (route) => route.abort());
            await page.route('**/*doubleclick.net*', (route) => route.abort());
            await page.route('**/*twitter.com*', (route) => route.abort());
            // Login
            await page.goto('https://www.city-data.com/forum/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.locator('#navbar_username').fill(username);
            await page.locator('#navbar_password').fill(password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
                page.locator('td.alt2 input[type="submit"]').click()
            ]);
            // Go to forum
            await page.goto('https://www.city-data.com/forum/world/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            // New thread
            const newThreadButton = page.getByAltText('Post New Thread').first();
            await newThreadButton.click();
            // Wait for form or rate limit
            const subjectInputLocator = page.locator('#inputthreadtitle');
            const rateLimitLocator = page.locator('div.panel:has-text("You have reached the maximum number of threads")');
            try {
                await Promise.race([
                    subjectInputLocator.waitFor({ state: 'visible', timeout: 30000 }),
                    rateLimitLocator.waitFor({ state: 'visible', timeout: 30000 })
                ]);
            } catch (e) {
                throw new Error('Neither the new thread form nor a rate limit message appeared.');
            }
            if (await rateLimitLocator.isVisible()) {
                const errorMessage = await rateLimitLocator.innerText();
                throw new Error(`Rate limit reached: ${errorMessage.trim()}`);
            }
            await subjectInputLocator.fill(`${title}`);
            await page.locator('#vB_Editor_001_textarea').click();
            await page.locator('#vB_Editor_001_textarea').fill(body);
            const postButton = page.locator('#vB_Editor_001_save');
            await postButton.click();
            await page.waitForURL('**/forum/world/*.html', { timeout: 60000 });
            const finalUrl = page.url();
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log('Cloudinary config at upload:', cloudinary.config());
            console.log('Uploading file:', screenshotPath, 'Exists:', fs.existsSync(screenshotPath));
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            this.log(`[SUCCESS] City-Data forum post created: ${finalUrl}`, 'success', true);
            this.log(`[SCREENSHOT] Screenshot uploaded: ${cloudinaryUrl}`, 'info', true);
            return { success: true, postUrl: finalUrl, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] CityDataForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

class PingInAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://ping.in/';
    }

    async publish() {
        this.log(`[EVENT] Entering PingInAdapter publish method for ${this.content.url}.`, 'info', true);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Launching Chromium browser...', 'detail', false);
            browser = await chromium.launch({ headless: true });
            this.log('[DEBUG] Chromium launched.', 'detail', false);
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(20000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            this.log('[EVENT] Locating title input field...', 'detail', false);
            const titleInput = page.locator('input[name="title"]');
            await titleInput.waitFor({ state: 'visible', timeout: 10000 });
            const titleToFill = this.content.title || this.website.title || '';
            await titleInput.fill(titleToFill);
            this.log(`[EVENT] Title input filled with: ${titleToFill}`, 'detail', false);

            this.log('[EVENT] Locating URL input field...', 'detail', false);
            const urlInput = page.locator('input[name="url"]');
            await urlInput.waitFor({ state: 'visible', timeout: 10000 });
            const urlToFill = this.content.url || this.website.url || '';
            await urlInput.fill(urlToFill);
            this.log(`[EVENT] URL input filled with: ${urlToFill}`, 'detail', false);

            this.log('[EVENT] Locating submit button...', 'detail', false);
            const submitButton = page.locator('button[type="submit"]');
            await submitButton.waitFor({ state: 'visible', timeout: 10000 });
            await submitButton.click();
            this.log('[EVENT] Submit button clicked.', 'detail', false);

            // Wait a short time for any post-submit processing
            await page.waitForTimeout(3000);

            // Take screenshot after submission
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.', 'info', true);

            // Upload screenshot to Cloudinary
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

            // Clean up local screenshot file
            fs.unlinkSync(screenshotPath);

            return { success: true, message: 'Ping submitted and screenshot taken.', screenshotUrl: cloudinaryUrl };

        } catch (error) {
            this.log(`[ERROR] PingInAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                this.log(`[EVENT] Error screenshot taken: ${errorScreenshotPath}`, 'info', true);
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
                console.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`);
                fs.unlinkSync(errorScreenshotPath);
            }
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

// --- PrePostSEO Ping Adapter ---
class PrePostSEOPingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.prepostseo.com/ping-multiple-urls-online';
    }

    async publish() {
        this.log(`[EVENT] Entering PrePostSEOPingAdapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            // Fill textarea with URL
            const urlToFill = this.website.public_website_1 || this.content.url || this.website.url || '';
            this.log(`[EVENT] Filling textarea with URL: ${urlToFill}`, 'detail', false);
            const textarea = page.locator('textarea#urls');
            await textarea.waitFor({ state: 'visible', timeout: 10000 });
            await textarea.fill(urlToFill);

            // Click 'Ping Now' button
            const pingNowBtn = page.locator('span#stepOne');
            await pingNowBtn.waitFor({ state: 'visible', timeout: 10000 });
            await pingNowBtn.click();
            this.log('[EVENT] Clicked Ping Now button.', 'detail', false);

            // Wait for 'Start Pinging' button to appear and click it
            const startPingingBtn = page.locator('span#pingConfirm');
            await startPingingBtn.waitFor({ state: 'visible', timeout: 20000 });
            await startPingingBtn.click();
            this.log('[EVENT] Clicked Start Pinging button.', 'detail', false);

            // Wait for pingBox to appear
            const pingBox = page.locator('div.pingBox');
            await pingBox.waitFor({ state: 'visible', timeout: 60000 });
            this.log('[EVENT] pingBox appeared.', 'detail', false);

            // Monitor pingBox for new pings
            let lastCount = 0;
            let allPingedUrls = [];
            let found63 = false;
            for (let i = 0; i < 180; i++) { // up to 3 minutes
                const html = await pingBox.innerHTML();
                // Match all lines like: <strong>63</strong> : xping.pubsub.com/ping/ :: <strong class="text-success">Success</strong><br>
                const regex = /<strong>(\d+)<\/strong> : ([^:]+) :: <strong class="text-success">Success<\/strong>/g;
                let match;
                let found = [];
                while ((match = regex.exec(html)) !== null) {
                    found.push({ num: match[1], url: match[2].trim() });
                }
                if (found.length > lastCount) {
                    for (let j = lastCount; j < found.length; j++) {
                        const url = found[j].url;
                        this.log(`Successfully pinged to ${url}`, 'success', true);
                        allPingedUrls.push(url);
                    }
                    lastCount = found.length;
                }
                // Stop as soon as we see <strong>63</strong>
                if (found.some(f => f.num === '63')) {
                    found63 = true;
                    break;
                }
                await page.waitForTimeout(1000);
            }
            if (!found63) {
                this.log('[WARNING] Timeout waiting for ping #63 to finish.', 'warning', true);
            }

            // Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            fs.unlinkSync(screenshotPath);

            return { success: true, pingedUrls: allPingedUrls, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] PrePostSEOPingAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
            }
            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

// --- BacklinkPing Adapter ---
class BacklinkPingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.backlinkping.com/online-ping-website-tool';
    }

    async publish() {
        this.log(`[EVENT] Entering BacklinkPingAdapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);

            // Prepare values
            const urlToFill = this.website.public_website_1 || this.content.url || this.website.url || '';
            let blogName = this.content.title || this.website.title;
            if (!blogName) {
                try {
                    const urlObj = new URL(urlToFill);
                    const parts = urlObj.hostname.split('.');
                    if (parts.length > 2) {
                        blogName = parts[Math.floor(parts.length / 2)];
                    } else if (parts.length === 2) {
                        blogName = parts[0];
                    } else {
                        blogName = urlObj.hostname;
                    }
                } catch (e) {
                    blogName = urlToFill;
                }
            }
            // Fill all fields
            await page.locator('#myurl').fill(urlToFill);
            await page.locator('#blogNameData').fill(blogName);
            await page.locator('#myBlogUpdateUrlData').fill(urlToFill);
            await page.locator('#myBlogRSSFeedUrlData').fill(urlToFill);
            this.log(`[EVENT] Filled all input fields.`, 'detail', false);

            // Click submit
            const submitBtn = page.locator('#checkButton');
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            await submitBtn.click();
            this.log('[EVENT] Clicked Submit button.', 'detail', false);

            // Wait for the results table to appear
            const tableSelector = 'table.table.table-bordered';
            await page.waitForSelector(tableSelector, { timeout: 60000 });
            this.log('[EVENT] Results table appeared.', 'detail', false);

            // Wait for all statuses to be green or for 'Processing...' to disappear
            let pingedUrls = [];
            for (let i = 0; i < 120; i++) { // up to 2 minutes
                const processingVisible = await page.locator('div:has-text("Processing...")').count();
                const rows = await page.locator(`${tableSelector} tbody tr`).all();
                let allGreen = true;
                pingedUrls = [];
                for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                    const statusCell = await rows[rowIdx].locator('td').nth(2);
                    const statusHtml = await statusCell.innerHTML();
                    if (statusHtml.includes('Thanks for the ping.')) {
                        const urlCell = await rows[rowIdx].locator('td').nth(1);
                        const pingUrl = (await urlCell.innerText()).trim();
                        this.log(`Successfully pinged to ${pingUrl}`, 'success', true);
                        pingedUrls.push(pingUrl);
                    } else {
                        allGreen = false;
                    }
                }
                if (allGreen || processingVisible === 0) {
                    break;
                }
                await page.waitForTimeout(1000);
            }

            // Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info', true);
            fs.unlinkSync(screenshotPath);

            return { success: true, pingedUrls, screenshotUrl: cloudinaryUrl };
        } catch (error) {
            this.log(`[ERROR] BacklinkPingAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
            }
            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

// --- ExciteSubmit Adapter ---
class ExciteSubmitAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://excitesubmit.com';
    }

    async publish() {
        this.log(`[EVENT] Entering ExciteSubmitAdapter publish method for ${this.content.url || this.website.url}.`, 'info', true);
        let browser;
        let context;
        let page;
        let lastApiCall = Date.now();
        let apiCallTimer;
        let screenshotUrl = '';
        let apiCallCount = 0;
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Intercept and log all POST requests to /api.php
            page.on('request', request => {
                if (request.method() === 'POST' && request.url().includes('/api.php')) {
                    lastApiCall = Date.now();
                    apiCallCount++;
                    this.log(`[PING] POST to api.php: ${request.url()} | data: ${request.postData()}`, 'info', true);
                }
            });
            page.on('response', async response => {
                if (response.url().includes('/api.php') && response.request().method() === 'POST') {
                    try {
                        const body = await response.text();
                        this.log(`[PING RESPONSE] ${response.url()} | ${body}`, 'success', true);
                        console.log(`[PING RESPONSE] ${response.url()} | ${body}`);
                    } catch (e) {
                        this.log(`[ERROR] Reading api.php response: ${e.message}`, 'error', true);
                    }
                }
            });

            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to excitesubmit.com', 'detail', false);

            // Fill the input
            const furlInput = page.locator('#furl');
            await furlInput.waitFor({ state: 'visible', timeout: 10000 });
            const urlToPing = this.content && this.content.url ? this.content.url : this.website.url;
            await furlInput.fill(urlToPing);
            this.log(`[EVENT] Filled #furl with: ${urlToPing}`, 'detail', false);

            // Click the submit button
            const submitBtn = page.locator('.frmSubmit[type="button"]');
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            await submitBtn.click();
            this.log('[EVENT] Clicked submit button.', 'detail', false);

            // Wait for inactivity (no api.php POST for 15s)
            await new Promise((resolve) => {
                function checkInactivity() {
                    const now = Date.now();
                    if (now - lastApiCall > 15000 && apiCallCount > 0) {
                        resolve();
                    } else {
                        apiCallTimer = setTimeout(checkInactivity, 1000);
                    }
                }
                checkInactivity();
            });

            // Take screenshot after inactivity
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after 15s inactivity.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            screenshotUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${screenshotUrl}`, 'info', true);
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${screenshotUrl}`);
            fs.unlinkSync(screenshotPath);

            return { success: true, screenshotUrl };
        } catch (error) {
            this.log(`[ERROR] ExciteSubmitAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
            }
            throw error;
        } finally {
            if (apiCallTimer) clearTimeout(apiCallTimer);
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

// --- Forum HTML Parser (for forums, more permissive than WordPressAdapter) ---
class ForumAdapter {
    static toBasicHtml(input) {
        if (!input) return '';
        let html = input;
        // 1. Convert markdown links first
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // 2. Now do bold/italic/underline, but NOT inside tags
        // Replace only text outside of tags
        html = html.replace(/(^|>)([^<]+)(?=<|$)/g, (match, p1, p2) => {
            return p1 + p2
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.*?)__/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/_(.*?)_/g, '<u>$1</u>');
        });
        // Lists
        html = html.replace(/^\s*[-\*\+] (.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        // Paragraphs (double newlines)
        html = html.replace(/\n{2,}/g, '<br/><br/>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Blockquotes
        html = html.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');
        // Pre/code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Clean up nested <ul>
        html = html.replace(/(<ul>\s*)+(<li>.*?<\/li>)(\s*<\/ul>)+/gs, '<ul>$2</ul>');
        return html;
    }
}

// --- OpenPathshala Forum Adapter ---
class OpenPathshalaForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting OpenPathshala forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title } = this.content;
        let body = this.content.body;
        // If body is not HTML, convert markdown to forum basic HTML
        if (!body || (!body.trim().startsWith('<') && !body.trim().endsWith('>'))) {
            const md = this.content.markdown || body || '';
            body = ForumAdapter.toBasicHtml(md);
        }
        let browser;
        let page;
        let context;
        let postScreenshotUrl = '';
        try {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Step 1: Go to login page
            await page.goto('https://openpathshala.com/user/login', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to login page.', 'detail', false);

            // Step 2: Fill login form
            await page.locator('input#edit-name[name="name"]').fill(username);
            await page.locator('input#edit-pass[name="pass"]').fill(password);
            this.log('[EVENT] Filled login form.', 'detail', false);

            // Step 3: Click login
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#edit-submit[type="submit"]').click()
            ]);
            this.log('[EVENT] Logged in successfully.', 'detail', false);

            // Step 4: Go to new forum post page
            await page.goto('https://openpathshala.com/node/add/forum/1', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to new forum post page.', 'detail', false);

            // Step 5: Fill subject
            await page.locator('input#edit-title[name="title"]').fill(title);
            this.log('[EVENT] Filled subject.', 'detail', false);

            // Step 6: Fill body (supports basic HTML)
            await page.evaluate((html) => {
                // Always set the textarea value
                const textarea = document.querySelector('textarea#edit-body-und-0-value');
                if (textarea) textarea.value = html;
                // If CKEditor is present, setData as well
                if (window.CKEDITOR && window.CKEDITOR.instances && window.CKEDITOR.instances['edit-body-und-0-value']) {
                    window.CKEDITOR.instances['edit-body-und-0-value'].setData(html);
                }
            }, body);
            this.log('[EVENT] Filled body.', 'detail', false);

            // Step 7: Click save
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#edit-submit[type="submit"]').click()
            ]);
            this.log('[EVENT] Submitted forum post.', 'detail', false);

            // Step 8: Get the URL of the posted forum
            const postedUrl = page.url();
            this.log(`[SUCCESS] Forum post created: ${postedUrl}`, 'success', true);

            // Take screenshot after posting
            const postScreenshotPath = `screenshot_post_${this.requestId}.png`;
            await page.screenshot({ path: postScreenshotPath, fullPage: true });
            const postCloudinaryUploadResult = await cloudinary.uploader.upload(postScreenshotPath);
            postScreenshotUrl = postCloudinaryUploadResult.secure_url;
            fs.unlinkSync(postScreenshotPath);
            this.log(`[SCREENSHOT] Post screenshot uploaded: ${postScreenshotUrl}`, 'info', true);

            return { success: true, postUrl: postedUrl, postScreenshotUrl };
        } catch (error) {
            this.log(`[ERROR] OpenPathshalaForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

// --- Boards.ie Forum Adapter ---
// has some bugs
class BoardsIEForumAdapter extends BaseAdapter {
    async publish() {
        this.log(`[EVENT] Starting Boards.ie forum publication for ${this.website.url}`, 'info', true);
        const { username, password } = this.website.credentials;
        const { title } = this.content;
        let body = this.content.body;
        if (!body || (!body.trim().startsWith('<') && !body.trim().endsWith('>'))) {
            const md = this.content.markdown || body || '';
            body = ForumAdapter.toBasicHtml(md);
        }
        let browser;
        let page;
        let context;
        let postScreenshotUrl = '';
        try {
            browser = await chromium.launch({ headless: false });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Step 1: Go to login page
            await page.goto('https://www.boards.ie/entry/signin', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to login page.', 'detail', false);

            // Step 2: Fill login form
            await page.locator('input#Form_Email[name="Email"]').fill(username);
            await page.locator('input#Form_Password[name="Password"]').fill(password);
            this.log('[EVENT] Filled login form.', 'detail', false);

            // Step 3: Click login
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#Form_SignIn[type="submit"]').click()
            ]);
            this.log('[EVENT] Logged in successfully.', 'detail', false);

            // Step 4: Go to new discussion page
            // The new discussion page is usually https://www.boards.ie/post/discussion
            // But to be robust, go to the homepage and click 'Start a Discussion' if needed
            await page.goto('https://www.boards.ie/post/discussion', { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigated to new discussion page.', 'detail', false);

            // --- Cloudflare/Turnstile bypass logic ---
            const cfBypasser = new CloudflareBypasser(page, 5, true);
            await cfBypasser.bypass();
            // --- End bypass logic ---

            // Step 5: Select category 'Internet Marketing / SEO' (value 985)
            const categorySelector = 'select#Form_CategoryID[name="CategoryID"]';
            await page.waitForSelector(categorySelector, { timeout: 60000 });
            await page.selectOption(categorySelector, { value: '985' });
            this.log('[EVENT] Selected category Internet Marketing / SEO.', 'detail', false);

            // Step 6: Fill title
            await page.locator('input#Form_Name[name="Name"]').fill(title);
            this.log('[EVENT] Filled title.', 'detail', false);

            // Step 7: Fill body (contenteditable div)
            // The body field is a Slate.js editor, so we need to set innerHTML
            await page.evaluate((html) => {
                const editable = document.querySelector('div[contenteditable="true"][data-slate-editor="true"]');
                if (editable) {
                    editable.innerHTML = html;
                }
            }, body);
            this.log('[EVENT] Filled body.', 'detail', false);

            // Step 8: Click 'Post Discussion'
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input#Form_PostDiscussion[type="submit"]').click()
            ]);
            this.log('[EVENT] Submitted forum post.', 'detail', false);

            // Step 9: Get the URL of the posted forum
            const postedUrl = page.url();
            this.log(`[SUCCESS] Forum post created: ${postedUrl}`, 'success', true);

            // Take screenshot after posting
            const postScreenshotPath = `screenshot_post_${this.requestId}.png`;
            await page.screenshot({ path: postScreenshotPath, fullPage: true });
            const postCloudinaryUploadResult = await cloudinary.uploader.upload(postScreenshotPath);
            postScreenshotUrl = postCloudinaryUploadResult.secure_url;
            fs.unlinkSync(postScreenshotPath);
            this.log(`[SCREENSHOT] Post screenshot uploaded: ${postScreenshotUrl}`, 'info', true);

            // Only mark as completed if no error occurred
            return { success: true, postUrl: postedUrl, postScreenshotUrl };
        } catch (error) {
            this.log(`[ERROR] BoardsIEForumAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[SCREENSHOT] Error screenshot uploaded: ${errorCloudinaryResult.secure_url}`, 'error', true);
                throw error;
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

// --- CloudflareBypasser Helper ---
class CloudflareBypasser {
    constructor(page, maxRetries = 5, log = true) {
        this.page = page;
        this.maxRetries = maxRetries;
        this.log = log;
    }

    async logMessage(msg) {
        if (this.log) console.log(msg);
    }

    async isBypassed() {
        const title = (await this.page.title()).toLowerCase();
        return !title.includes('just a moment') && !title.includes('attention required');
    }

    async clickVerificationButton() {
        try {
            // Try to find the Turnstile/Cloudflare challenge in all frames
            const frames = this.page.frames();
            for (const frame of frames) {
                const input = await frame.$('input[type="checkbox"], input[type="submit"], button');
                if (input) {
                    await this.logMessage('Verification input/button found in frame. Attempting to click.');
                    await input.click();
                    return true;
                }
            }
            // Try to click the challenge button in the main page as fallback
            const mainInput = await this.page.$('input[type="checkbox"], input[type="submit"], button');
            if (mainInput) {
                await this.logMessage('Verification input/button found on main page. Attempting to click.');
                await mainInput.click();
                return true;
            }
            await this.logMessage('Verification button not found.');
            return false;
        } catch (e) {
            await this.logMessage(`Error clicking verification button: ${e}`);
            return false;
        }
    }

    async bypass() {
        let tryCount = 0;
        while (!(await this.isBypassed())) {
            if (this.maxRetries > 0 && tryCount >= this.maxRetries) {
                await this.logMessage('Exceeded maximum retries. Bypass failed.');
                break;
            }
            await this.logMessage(`Attempt ${tryCount + 1}: Verification page detected. Trying to bypass...`);
            await this.clickVerificationButton();
            tryCount += 1;
            await this.page.waitForTimeout(2000);
        }
        if (await this.isBypassed()) {
            await this.logMessage('Bypass successful.');
            return true;
        } else {
            await this.logMessage('Bypass failed.');
            return false;
        }
    }
}

// Adapter map declaration moved above getAdapter to fix ReferenceError
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
    '../controllers/ping/pingMyLinksController.js': PingMyLinksAdapter,
    'pingmylinks/googleping': PingMyLinksAdapter,
    'pingmylinks/searchsubmission': PingMyLinksAdapter,
    'pingmylinks/socialsubmission': PingMyLinksAdapter,
    'https://www.pingmylinks.com/googleping': PingMyLinksAdapter,
    'https://www.pingmylinks.com/addurl/socialsubmission': PingMyLinksAdapter,
    'https://www.pingmylinks.com/addurl/searchsubmission': PingMyLinksAdapter,
    '../controllers/search/secretSearchEngineLabsController.js': SecretSearchEngineLabsAdapter,
    '../controllers/search/activeSearchResultsController.js': ActiveSearchResultsAdapter,
    '../controllers/redditController.js': RedditAdapter,
    '../controllers/social_media/twitterController.js': TwitterAdapter,
    '../controllers/social_media/facebookController.js': FacebookAdapter,
    '../controllers/social_media/instagramController.js': InstagramAdapter,
    '../controllers/bookmarking/bookmarkZooController.js': BookmarkZooAdapter,
    '../controllers/bookmarking/teslaBookmarksController.js': TeslaPearlBookmarkingAdapter,
    'directory/gainweb': GainWebAdapter,
    'directory/socialsubmissionengine': SocialSubmissionEngineAdapter,
    'directory': GainWebAdapter,
    'bookmarking/ubookmarking': UBookmarkingAdapter,
    'devto': DevToAdapter,
    'blog/devto': DevToAdapter,
    'hashnode': HashnodeAdapter,
    'blog/hashnode': HashnodeAdapter,
    'tumblr.com': TumblrAdapter,
    'blog/tumblr': TumblrAdapter,
    '../controllers/forum/delphiController.js': DelphiForumAdapter,
    '../controllers/forum/cityDataController.js': CityDataForumAdapter,
    'forum/delphi': DelphiForumAdapter,
    'forum/citydata': CityDataForumAdapter,
    'delphiforums.com': DelphiForumAdapter,
    'city-data.com': CityDataForumAdapter,
    'ping/ping.in': PingInAdapter,
    'ping': PingInAdapter,
    'https://ping.in': PingInAdapter,
    'ping.in': PingInAdapter,
    'ping/prepostseo.com': PrePostSEOPingAdapter,
    'https://www.prepostseo.com': PrePostSEOPingAdapter,
    'https://www.prepostseo.com/ping-multiple-urls-online': PrePostSEOPingAdapter,
    'prepostseo.com': PrePostSEOPingAdapter,
    'ping/backlinkping.com': BacklinkPingAdapter,
    'https://www.backlinkping.com/online-ping-website-tool': BacklinkPingAdapter,
    'https://www.backlinkping.com': BacklinkPingAdapter,
    'backlinkping.com': BacklinkPingAdapter,
    'ping/excitesubmit.com': ExciteSubmitAdapter,
    'https://excitesubmit.com': ExciteSubmitAdapter,
    'excitesubmit.com': ExciteSubmitAdapter,
    'forum/openpathshala.com': OpenPathshalaForumAdapter,
    'openpathshala.com': OpenPathshalaForumAdapter,
    'forum/boards.ie': BoardsIEForumAdapter,
    'boards.ie': BoardsIEForumAdapter,
};

export const getAdapter = (jobDetails) => {
    const controllerPath = getControllerForWebsite(jobDetails.website);
    console.log(`[getAdapter] controllerPath: ${controllerPath}`);
    console.log(`[getAdapter] jobDetails.website.category: ${jobDetails.website.category}`);
    console.log(`[getAdapter] jobDetails.website.url: ${jobDetails.website.url}`);

    if (controllerPath && adapterMap[controllerPath]) {
        const AdapterClass = adapterMap[controllerPath];
        return new AdapterClass(jobDetails);
    }

    // NEW: Try matching by full URL
    if (jobDetails.website.url && adapterMap[jobDetails.website.url]) {
        const AdapterClass = adapterMap[jobDetails.website.url];
        return new AdapterClass(jobDetails);
    }

    // Fallback: try matching by domain (hostname)
    try {
        const urlObj = new URL(jobDetails.website.url);
        const hostname = urlObj.hostname;
        if (adapterMap[hostname]) {
            const AdapterClass = adapterMap[hostname];
            return new AdapterClass(jobDetails);
        }
    } catch (e) {
        // ignore URL parse errors
    }

    // Fallback: try matching by category (as a last resort)
    if (jobDetails.website.category && adapterMap[jobDetails.website.category]) {
        const AdapterClass = adapterMap[jobDetails.website.category];
        return new AdapterClass(jobDetails);
    }

    return null;
};

// --- Adapter Factory ---
// Removed duplicate adapterMap and getAdapter declarations to fix redeclaration error

if (process.env.USE_REDIS_CLUSTER === '1' || process.env.USE_REDIS_CLUSTER === 'true') {
  const redisCluster = new IORedis.Cluster([
    {
      host: process.env.REDIS_HOST || 'redis',
      port: Number(process.env.REDIS_PORT) || 6379,
    }
  ], {
    natMap: {
      'redis:6379': { host: 'localhost', port: 6379 },
    }
  });
  redisCluster.on('error', (err) => {
    console.error('[controllerAdapters.js][REDIS CLUSTER ERROR]', err);
  });
  (async () => {
    try {
      await redisCluster.set('test-cluster', 'hello from Redis Cluster');
      const value = await redisCluster.get('test-cluster');
      console.log('[controllerAdapters.js] Redis value (cluster):', value);
    } catch (err) {
      console.error('[controllerAdapters.js][REDIS CLUSTER ERROR]', err);
    }
  })();
}
