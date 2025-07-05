import { chromium } from 'playwright-extra';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import * as websocketLogger from './websocketLogger.js';
import { getControllerForWebsite } from './websiteClassifier.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import cloudinary from 'cloudinary';
import fs from 'fs';

import { getRedditAccessToken, submitRedditPost } from './controllers/redditController.js';
import { sendTweet } from './controllers/social_media/twitterController.js';
import { postToFacebook } from './controllers/social_media/facebookController.js';
import { postToInstagram } from './controllers/social_media/instagramController.js';
import { UBookmarkingAdapter } from './controllers/bookmarking/ubookmarkingController.js';
import { OAuth } from 'oauth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

chromium.use(StealthPlugin());

// --- Base Adapter Class (for potential future extension) ---
class BaseAdapter {
    constructor({ requestId, website, content }) {
        this.requestId = requestId;
        this.website = website; // Contains url, category, and credentials
        this.content = content;
        // Credentials are now located at this.website.credentials
        this.category = website.category; // Store category directly for easy access
        this.collectedLogs = []; // Array to store logs for this specific adapter instance
    }

    log(message, level = 'detail', isProductionLog = false) {
        // Add a prefix to distinguish logs from different adapters
        const formattedMessage = `[${this.constructor.name}] ${message}`;
        // Store log message and level internally
        this.collectedLogs.push({ message: formattedMessage, level: level });

        // Only send to websocketLogger if isProductionLog is true OR if not in production environment
        if (isProductionLog || process.env.NODE_ENV !== 'production') {
            websocketLogger.log(this.requestId, formattedMessage, level);
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
            return { success: false, error: error.message };
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
        
        // Determine the target PingMyLinks URL based on the category
        const targetPingUrl = this.pingUrls[this.website.category];
        if (!targetPingUrl) {
            throw new Error(`Unsupported PingMyLinks category: ${this.website.category}`);
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
                // Use the URL from this.website.url (the URL to be pinged)
                await furlInput.fill(this.website.url);
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
            return { success: false, error: error.message };
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
            return { success: false, error: error.message };
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
                return { success: false, error: error.message };
            }

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
            this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
            this.log('----------------------', 'error', true);
            this.log('[EVENT] An error occurred.', 'error', true);
            return { success: false, error: error.message };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: error.message };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: error.message };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: error.message };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: error.message };
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
            return { success: false, error: error.message };
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
            browser = await chromium.launch({ headless: false });
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
            const urlSelector =  'input[name="_story_url"]';
            const titleSelector =  'input[name="title"]';
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
            return { success: false, error: error.message };
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

            return { success: false, error: error.message };
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

            return { success: false, error: error.message };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: errorMsg };
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
            return { success: false, error: errorMessage };
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
            return { success: false, error: errorMsg };
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
            return { success: false, error: errorMsg };
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
            return { success: false, error: errorMessage };
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

// Adapter map declaration moved above getAdapter to fix ReferenceError
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
    '../controllers/ping/pingMyLinksController.js': PingMyLinksAdapter,
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

    // Fallback: try matching by category
    if (jobDetails.website.category && adapterMap[jobDetails.website.category]) {
        const AdapterClass = adapterMap[jobDetails.website.category];
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

    return null;
};

// --- Adapter Factory ---
// Removed duplicate adapterMap and getAdapter declarations to fix redeclaration error
