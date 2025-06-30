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
    }

    log(message, level = 'detail') {
        // Add a prefix to distinguish logs from different adapters
        const formattedMessage = `[${this.constructor.name}] ${message}`;
        websocketLogger.log(this.requestId, formattedMessage, level);
    }

    async publish() {
        throw new Error('Publish method not implemented!');
    }
}


// --- WordPress Adapter ---
class WordPressAdapter extends BaseAdapter {
    async loginAndExtract() {
        let browser;
        this.log(`Launching browser for login at ${this.website.url}`);
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({ ignoreHTTPSErrors: true });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Construct the standard WordPress login URL and navigate there directly.
            const loginUrl = `${this.website.url.replace(/\/$/, '')}/login`;
            this.log(`Navigating to login page: ${loginUrl}`);
            await page.goto(loginUrl, { waitUntil: 'networkidle' });

            // Add the user's provided selectors to make the locator more robust.
            const usernameLocator = page.locator('input[name="username"], input[name="user_login"], input[name="log"], input[name="usr"]');
            const passwordLocator = page.locator('input[name="password"], input[name="user_pass"], input[name="pwd"], input[name="pass"]');
            // Use credentials from the website object
            await usernameLocator.fill(this.website.credentials.username);
            await passwordLocator.fill(this.website.credentials.password);
            
            this.log('Credentials filled. Clicking submit...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle' }),
                page.click('input[type="submit"], button[type="submit"], #wp-submit')
            ]);
            
            const newPostUrl = `${this.website.url.replace(/\/$/, '')}/new-post`;
            this.log(`Logged in. Navigating to new post page: ${newPostUrl}`);
            await page.goto(newPostUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('form[id="post"]', { timeout: 15000 });

            const cookies = await context.cookies();
            const hiddenInputs = await page.$$eval('form[id="post"] input[type="hidden"]', inputs =>
                inputs.reduce((obj, el) => {
                    obj[el.name] = el.value;
                    return obj;
                }, {})
            );
            
            this.log(`Extracted ${cookies.length} cookies and ${Object.keys(hiddenInputs).length} hidden inputs.`, 'info');
            return { cookies, hiddenInputs, newPostUrl };
        } finally {
            if (browser) {
                await browser.close();
                this.log(`Browser closed after extraction.`);
            }
        }
    }

    async postWithAxios(cookies, hiddenInputs, newPostUrl) {
        this.log('Posting article with extracted session data...');
        const jar = new CookieJar();
        for (const cookie of cookies) {
            const url = `https://${cookie.domain.replace(/\/$/, '')}`;
            await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
        }

        const client = wrapper(axios.create({ jar }));

        const form = { ...hiddenInputs, post_title: this.content.title, content: this.content.body, publish: 'Publish' };
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
            this.log('Failed to find post URL in response. The page HTML will be logged for debugging.', 'error');
            throw new Error('Could not find the final post URL in the response page. Check logs for HTML snippet.');
        }
        
        const successMessage = `Successfully extracted post URL: ${postUrl}`;
        this.log(successMessage, 'success');
        console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
        return postUrl;
    }

    async publish() {
        this.log(`Starting WordPress publication for ${this.website.url}`, 'info');
        try {
            const { cookies, hiddenInputs, newPostUrl } = await this.loginAndExtract();
            const postUrl = await this.postWithAxios(cookies, hiddenInputs, newPostUrl);
            const successMessage = `Publication successful! URL: ${postUrl}`;
            this.log(successMessage, 'success');
            console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
            return { success: true, postUrl };
        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error');
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
        this.log('[DEBUG] PingMyLinksAdapter.publish() entered.');
        this.log('[EVENT] Entering PingMyLinksAdapter publish method.');
        
        // Determine the target PingMyLinks URL based on the category
        const targetPingUrl = this.pingUrls[this.website.category];
        if (!targetPingUrl) {
            throw new Error(`Unsupported PingMyLinks category: ${this.website.category}`);
        }

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...');
            browser = await chromium.launch({ headless: false }); // Changed to headless: false for debugging
            this.log('[DEBUG] chromium.launch() completed.');
            this.log('[EVENT] Browser launched successfully.');
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to target page: ${targetPingUrl}`);
            await page.goto(targetPingUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.');

            this.log('[EVENT] Setting up page event listeners.');
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
                  this.log(`Successfully pinged to this website: ${responseBody}`);
                  console.log(`Successfully pinged to this website: ${responseBody}`);
                } catch (e) {
                  this.log(`Error reading API.PHP response body: ${e.message}`, 'error');
                  console.error(`Error reading API.PHP response body: ${e.message}`);
                }
              }
            });

            page.on('pageerror', error => {
            });

            page.on('console', msg => {
            });

            // START: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC
            this.log('[EVENT] Locating URL input field...');
            const furlInput = page.locator('#furl');
            try {
                await furlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...');
                // Use the URL from this.website.url (the URL to be pinged)
                await furlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-furl-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-furl-input-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...');
            const submitButton = page.locator('.frmSubmit[type="button"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...');
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submit-button-error-screenshot.png`);
                }
                throw error;
            }
            // END: RESTORED URL FILLING AND SUBMIT BUTTON CLICK LOGIC

            this.log('[EVENT] Waiting for submission completion message (indefinitely)...');
            const successMessageSelector = 'div.messageok';
            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 0 });
                const messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Submission Complete!')) {
                    this.log(`[SUCCESS] Submission Complete! Message: ${messageText}`, 'success');
                } else {
                    this.log(`[WARNING] Submission Complete message found, but text is not as expected: ${messageText}`, 'warning');
                }
            } catch (error) {
                this.log(`[ERROR] Failed to find submission complete message: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-submission-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-submission-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[SUCCESS] Script finished successfully.', 'success');
            return { success: true };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred.', 'error');
            return { success: false, error: error.message };
        } finally {
            if (browser) {
                if (page) {
                    const screenshotCompletionPath = `screenshot_completion_${this.requestId}.png`;
                    await page.screenshot({ path: screenshotCompletionPath, fullPage: true });
                    this.log('[EVENT] Screenshot taken after completion.');

                    const cloudinaryUploadCompletionResult = await cloudinary.uploader.upload(screenshotCompletionPath);
                    this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`, 'info');
                    console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUploadCompletionResult.secure_url}`);

                    fs.unlinkSync(screenshotCompletionPath);
                } else {
                    this.log('[EVENT] Page instance was not created, skipping completion screenshot.', 'warning');
                }

                await browser.close();
                this.log('[EVENT] Browser closed after execution.');
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning');
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
        this.log(`[EVENT] Entering SecretSearchEngineLabsAdapter publish method for ${this.website.url}.`);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...');
            browser = await chromium.launch({ headless: false }); // Changed to headless: false for debugging
            this.log('[DEBUG] chromium.launch() completed.');
            this.log('[EVENT] Browser launched successfully.');
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to submission page: ${this.submissionUrl}`);
            await page.goto(this.submissionUrl, { waitUntil: 'networkidle', timeout: 60000 });
            this.log('[EVENT] Navigation complete.');

            this.log('[EVENT] Locating URL input field...');
            const urlInput = page.locator('input[name="newurl"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...');
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-url-input-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...');
            const submitButton = page.locator('input[type="submit"][value="Add URL"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...');
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or click submit button: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submit-button-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submit-button-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[EVENT] Waiting for submission result message...');
            // Check for success or already submitted message
            const successMessageSelector = 'body'; // The message is directly in the body as a <b> tag
            await page.waitForTimeout(3000); // Give some time for content to load after submission

            let successMessage = '';
            let cloudinaryUrl = '';

            try {
                const bodyContent = await page.textContent('body');
                if (bodyContent.includes('is already included in the index, no need to resubmit!')) {
                    successMessage = `URL ${this.website.url} is already included in the index, no need to resubmit!`;
                    this.log(`[INFO] ${successMessage}`, 'info');
                } else if (bodyContent.includes('URL added to queue!')) { // Assuming this is the success message
                    successMessage = `URL ${this.website.url} successfully added to queue!`;
                    this.log(`[SUCCESS] ${successMessage}`, 'success');
                } else {
                    successMessage = `Unknown submission result for ${this.website.url}. Body content: ${bodyContent.substring(0, 200)}...`;
                    this.log(`[WARNING] ${successMessage}`, 'warning');
                }

                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.');

                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info');
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

                fs.unlinkSync(screenshotPath);

            } catch (error) {
                this.log(`[ERROR] Failed to determine submission message or upload screenshot: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-seclabs-submission-result-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-seclabs-submission-result-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[SUCCESS] Script finished successfully.', 'success');
            return { success: true, message: successMessage, cloudinaryUrl: cloudinaryUrl };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred.', 'error');
            return { success: false, error: error.message };
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.');
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning');
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
        this.log(`[EVENT] Entering ActiveSearchResultsAdapter publish method for ${this.website.url}.`);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...');
            browser = await chromium.launch({ headless: false }); // Changed to headless: false for debugging
            this.log('[DEBUG] chromium.launch() completed.');
            this.log('[EVENT] Browser launched successfully.');
            context = await browser.newContext();
            page = await context.newPage();

            this.log(`[EVENT] Navigating to submission page: ${this.submissionUrl}`);
            await page.goto(this.submissionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            this.log('[EVENT] Navigation complete.');

            this.log('[EVENT] Locating URL input field...');
            const urlInput = page.locator('input[name="url"]');
            try {
                await urlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...');
                await urlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-url-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-url-input-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[EVENT] Locating Email input field...');
            const emailInput = page.locator('input[name="email"]');
            try {
                await emailInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling Email input field...');
                await emailInput.fill(this.website.credentials.email);
                this.log('[EVENT] Email input field filled.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill Email input field: ${error.message}`, 'error');
                if (page) {
                    await page.screenshot({ path: `${this.requestId}-activesearchresults-email-input-error-screenshot.png` });
                    this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-email-input-error-screenshot.png`);
                }
                throw error;
            }

            this.log('[EVENT] Locating submit button...');
            const submitButton = page.locator('input[type="submit"][name="submiturl"]');
            try {
                await submitButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Clicking submit button...');
                await submitButton.click();
                this.log('[EVENT] Submit button clicked.');

                // Take a screenshot immediately after clicking the submit button for debugging
                const postSubmitScreenshotPath = `${this.requestId}-post-submit-screenshot.png`;
                await page.screenshot({ path: postSubmitScreenshotPath, fullPage: true });
                this.log(`[EVENT] Screenshot taken immediately after submit button click: ${postSubmitScreenshotPath}`, 'info');
                const cloudinaryPostSubmitUploadResult = await cloudinary.uploader.upload(postSubmitScreenshotPath);
                this.log(`[EVENT] Post-submit screenshot uploaded to Cloudinary: ${cloudinaryPostSubmitUploadResult.secure_url}`, 'info');
                fs.unlinkSync(postSubmitScreenshotPath);

                this.log('[EVENT] Waiting for success message to appear and taking screenshot...');

                // Log the full page content for debugging
                const pageHtml = await page.content();
                this.log(`[DEBUG] Page HTML after submission: ${pageHtml.substring(0, 500)}...`, 'detail');

                // Wait for the success message to appear
                const successMessageSelector = 'h1';
                try {
                    await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                    const messageText = await page.textContent(successMessageSelector);
                    if (!messageText || !messageText.includes('Added Web Site Confirmation')) {
                        throw new Error('Success message not found or not as expected.');
                    }
                    this.log(`[INFO] Submission confirmation message: ${messageText}`, 'info');
                } catch (error) {
                    this.log(`[ERROR] Failed to find submission confirmation message: ${error.message}`, 'error');
                    if (page) {
                        await page.screenshot({ path: `${this.requestId}-activesearchresults-confirmation-error-screenshot.png` });
                        this.log(`[EVENT] Screenshot saved as ${this.requestId}-activesearchresults-confirmation-error-screenshot.png`);
                    }
                    throw error;
                }

                const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                this.log('[EVENT] Screenshot taken after completion.');

                const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
                const cloudinaryUrl = cloudinaryUploadResult.secure_url;
                this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info');
                console.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

                fs.unlinkSync(screenshotPath); // Clean up the local screenshot file

                this.log('[SUCCESS] Script finished successfully.', 'success');
                return { success: true, message: 'URL submitted and screenshot taken.', cloudinaryUrl: cloudinaryUrl };

            } catch (error) {
                this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
                this.log(`[ERROR] Global script error: ${error.message}`, 'error');
                this.log('----------------------', 'error');
                this.log('[EVENT] An error occurred.', 'error');
                return { success: false, error: error.message };
            }

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred.', 'error');
            return { success: false, error: error.message };
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.');
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning');
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
        this.log(`[EVENT] Entering RedditAdapter publish method for ${this.website.url}.`);
        const { clientId, clientSecret, username, password, subreddit } = this.website.credentials;
        const { title, body } = this.content;

        if (!clientId || !clientSecret || !username || !password || !subreddit || !title || !body) {
            const errorMessage = 'Missing required Reddit credentials or content fields.';
            this.log(`[ERROR] ${errorMessage}`, 'error');
            return { success: false, error: errorMessage };
        }

        try {
            this.log('[EVENT] Attempting to get Reddit access token...');
            const accessToken = await getRedditAccessToken(clientId, clientSecret, username, password);
            this.log('[SUCCESS] Access token obtained successfully.');

            this.log('[EVENT] Submitting post to Reddit...');
            const postUrl = await submitRedditPost(accessToken, subreddit, title, body, username);
            
            this.log(`[SUCCESS] Reddit post created successfully! URL: ${postUrl}`, 'success');
            return { success: true, postUrl: postUrl };

        } catch (error) {
            this.log(`[ERROR] Reddit post creation failed: ${error.message}`, 'error');
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
        this.log(`[EVENT] Entering TwitterAdapter publish method.`);
        const { appKey, appSecret, accessToken, accessSecret } = this.website.credentials;
        const tweetText = this.content.body; // Assuming the tweet content is in content.body

        if (!appKey || !appSecret || !accessToken || !accessSecret || !tweetText) {
            const errorMessage = 'Missing required Twitter credentials or tweet text.';
            this.log(`[ERROR] ${errorMessage}`, 'error');
            return { success: false, error: errorMessage };
        }

        try {
            this.log('[EVENT] Attempting to send tweet...');
            const tweetResult = await sendTweet({ appKey, appSecret, accessToken, accessSecret }, tweetText);
            
            if (tweetResult.success) {
                this.log(`[SUCCESS] Tweet posted successfully! URL: ${tweetResult.tweetUrl}`, 'success');
                return { success: true, tweetUrl: tweetResult.tweetUrl };
            } else {
                throw new Error(tweetResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Twitter post failed: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }
}

// --- Adapter Factory ---
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
    '../controllers/ping/pingMyLinksController.js': PingMyLinksAdapter, // Assuming this is the correct path for the new controller
    '../controllers/search/secretSearchEngineLabsController.js': SecretSearchEngineLabsAdapter, // New adapter for Secret Search Engine Labs
    '../controllers/search/activeSearchResultsController.js': ActiveSearchResultsAdapter, // New adapter for Active Search Results
    '../controllers/redditController.js': RedditAdapter, // New adapter for Reddit
    '../controllers/social_media/twitterController.js': TwitterAdapter, // New adapter for Twitter
    // Add other controllers here
};

export const getAdapter = (jobDetails) => {
    // jobDetails now contains { requestId, website, content }
    // The 'website' object itself has the credentials needed by the adapter.
    const controllerPath = getControllerForWebsite(jobDetails.website);
    
    if (controllerPath && adapterMap[controllerPath]) {
        const AdapterClass = adapterMap[controllerPath];
        return new AdapterClass(jobDetails);
    }

    return null;
}; 