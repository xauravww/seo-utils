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

// --- Facebook Adapter ---
class FacebookAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering FacebookAdapter publish method.`);
        const { appId, appSecret, pageAccessToken, pageId } = this.website.credentials;
        const message = this.content.body; // Assuming the post content is in content.body

        if (!appId || !appSecret || !pageAccessToken || !pageId || !message) {
            const errorMessage = 'Missing required Facebook credentials or post message.';
            this.log(`[ERROR] ${errorMessage}`, 'error');
            return { success: false, error: errorMessage };
        }

        try {
            this.log('[EVENT] Attempting to post to Facebook...');
            const facebookPostResult = await postToFacebook({ appId, appSecret, pageAccessToken, pageId }, message);
            
            if (facebookPostResult.success) {
                this.log(`[SUCCESS] Facebook post created successfully! URL: ${facebookPostResult.postUrl}`, 'success');
                return { success: true, postUrl: facebookPostResult.postUrl };
            } else {
                throw new Error(facebookPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Facebook post failed: ${error.message}`, 'error');
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
        this.log(`[EVENT] Entering InstagramAdapter publish method.`);
        const { pageId, accessToken } = this.website.credentials;
        const { imageUrl, caption } = this.content; // Assuming content will have imageUrl and caption

        if (!pageId || !accessToken || !imageUrl || !caption) {
            const errorMessage = 'Missing required Instagram credentials or content fields (pageId, accessToken, imageUrl, caption).';
            this.log(`[ERROR] ${errorMessage}`, 'error');
            return { success: false, error: errorMessage };
        }

        try {
            this.log('[EVENT] Attempting to post to Instagram...');
            const instagramPostResult = await postToInstagram({ pageId, accessToken }, { imageUrl, caption });
            
            if (instagramPostResult.success) {
                this.log(`[SUCCESS] Instagram post created successfully! URL: ${instagramPostResult.postUrl}`, 'success');
                return { success: true, postUrl: instagramPostResult.postUrl };
            } else {
                throw new Error(instagramPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Instagram post failed: ${error.message}`, 'error');
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
        this.log(`[EVENT] Entering BookmarkZooAdapter publish method.`);

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
            page.setDefaultTimeout(60000);

            // Step 1: Login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.');

            this.log('[EVENT] Filling login form...');
            await page.locator('input[name="username"]').fill(this.website.credentials.username);
            await page.locator('input[name="password"]').fill(this.website.credentials.password);
            await page.locator('input[name="captcha"]').fill('2'); // Captcha is always 2
            this.log('[EVENT] Login form filled. Clicking login button...');
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.locator('input[type="submit"][value="Login"]').click()
            ]);
            this.log('[EVENT] Login successful, navigated to new page.');

            // Step 2: Navigate to submission page
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.');

            // Step 3: Fill submission form
            this.log('[EVENT] Filling submission form...');
            await page.locator('input[name="submit_url"]').fill(this.content.url || this.website.url);
            await page.locator('input[name="submit_title"]').fill(this.content.title);
            await page.locator('textarea[name="submit_body"]').fill(this.content.body);
            this.log('[EVENT] Submission form filled. Clicking submit button...');

            // Step 4: Submit the bookmark
            await Promise.all([
                page.waitForResponse(response => response.url().includes('/submit') && response.status() === 200), // Wait for a successful response on submit
                page.locator('button[type="submit"][id="publish"]').click()
            ]);
            this.log('[EVENT] Submit button clicked. Waiting for success message.');

            // Step 5: Extract the posted URL
            const successMessageSelector = 'div.alert.alert-success#msg-flash a';
            await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
            const postUrl = await page.getAttribute(successMessageSelector, 'href');

            if (!postUrl) {
                throw new Error('Could not extract the posted URL from the success message.');
            }
            this.log(`[SUCCESS] Bookmark posted successfully! URL: ${postUrl}`, 'success');

            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.');

            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info');

            fs.unlinkSync(screenshotPath);

            return { success: true, postUrl: postUrl, cloudinaryUrl: cloudinaryUrl };

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
            }
        }
    }
}

// --- TeslaBookmarks Adapter ---
class TeslaBookmarksAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://teslabookmarks.com/?success=1#tab-login';
        this.submitUrl = 'https://teslabookmarks.com/index.php/submit-story/';
    }

    async publish() {
        this.log(`[EVENT] Entering TeslaBookmarksAdapter publish method.`);

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
            page.setDefaultTimeout(60000); // Increased timeout for potentially slow pages

            // Step 1: Login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.');

            this.log('[EVENT] Filling login form...');
            await page.locator('input[name="log"]').fill(this.website.credentials.username);
            await page.locator('input[name="pwd"]').fill(this.website.credentials.password);
            this.log('[EVENT] Login form filled. Clicking login button...');
            
            await Promise.all([
                page.locator('input[type="submit"][name="wp-submit"]').click(),
                page.locator('#popup').waitFor({ state: 'hidden', timeout: 30000 }) // Wait for the login popup to be hidden
            ]);
            this.log('[EVENT] Login successful, popup hidden.');

            // Step 2: Navigate to submission page
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.');

            // Step 3: Fill submission form
            this.log('[EVENT] Filling submission form...');
            await page.locator('input[name="_story_url"]').fill(this.content.url || this.website.url);
            await page.locator('input[name="title"]').fill(this.content.title);
            await page.locator('select[name="story_category"]').selectOption({ value: '87550' }); // Value for 'other'
            await page.locator('textarea[name="description"]').fill(this.content.body);
            this.log('[EVENT] Submission form filled. Clicking submit button...');

            // Step 4: Take screenshot before submission confirmation
            const preSubmissionScreenshotPath = `screenshot_presubmission_${this.requestId}.png`;
            await page.screenshot({ path: preSubmissionScreenshotPath, fullPage: true });
            this.log('[EVENT] Pre-submission screenshot taken.');
            const cloudinaryPreSubmissionUploadResult = await cloudinary.uploader.upload(preSubmissionScreenshotPath);
            const preSubmissionCloudinaryUrl = cloudinaryPreSubmissionUploadResult.secure_url;
            this.log(`[EVENT] Pre-submission screenshot uploaded to Cloudinary: ${preSubmissionCloudinaryUrl}`, 'info');
            fs.unlinkSync(preSubmissionScreenshotPath);

            // Add network logging for debugging the submission
            page.on('request', request => {
                this.log(`[NETWORK REQUEST] ${request.method()} ${request.url()}`, 'detail');
                if (request.postData()) {
                    this.log(`[NETWORK REQUEST PAYLOAD] ${request.postData()}`, 'detail');
                }
            });
            page.on('response', async response => {
                this.log(`[NETWORK RESPONSE] ${response.status()} ${response.url()}`, 'detail');
                try {
                    const responseBody = await response.text();
                    this.log(`[NETWORK RESPONSE BODY] ${responseBody.substring(0, 500)}...`, 'detail'); // Log first 500 chars
                } catch (e) {
                    this.log(`[NETWORK RESPONSE BODY ERROR] Could not read response body: ${e.message}`, 'detail');
                }
            });

            // Step 5: Submit the story
            await Promise.all([
                page.waitForResponse(response => response.url().includes('/submit-story/') && response.status() === 200),
                page.locator('input[type="submit"][name="submit"]').click()
            ]);
            this.log('[EVENT] Submit button clicked. Waiting for success message.');

            // Step 6: Confirm submission and take final screenshot
            const successMessageSelector = 'div.alert.alert-success';
            const alreadySubmittedMessageSelector = 'div.alert.alert-danger';
            let messageText = null;
            let isSuccess = false;

            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Your story has been submitted. but your story is pending review.')) {
                    isSuccess = true;
                }
            } catch (error) {
                this.log(`[DEBUG] Primary success message not found, checking for already submitted message.`, 'detail');
            }

            if (!isSuccess) {
                try {
                    await page.waitForSelector(alreadySubmittedMessageSelector, { state: 'visible', timeout: 15000 });
                    messageText = await page.textContent(alreadySubmittedMessageSelector);
                    if (messageText && messageText.includes('The url is already been submitted, but this story is pending review.')) {
                        isSuccess = true; // Consider this a success as the URL is handled
                    }
                } catch (error) {
                    this.log(`[DEBUG] Already submitted message not found.`, 'detail');
                }
            }

            if (!isSuccess || !messageText) {
                const errorMessage = 'Submission confirmation message not found or not as expected.';
                this.log(`[ERROR] ${errorMessage}`, 'error');
                console.error(`[${this.requestId}] [TeslaBookmarksAdapter] ${errorMessage}`);
                throw new Error(errorMessage);
            }

            this.log(`[SUCCESS] Submission confirmation message: ${messageText}`, 'success');
            console.log(`[${this.requestId}] [TeslaBookmarksAdapter] ${messageText}`);

            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.');

            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info');
            console.log(`[${this.requestId}] [TeslaBookmarksAdapter] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

            fs.unlinkSync(screenshotPath);

            return { success: true, message: messageText, preSubmissionScreenshot: preSubmissionCloudinaryUrl, postSubmissionScreenshot: cloudinaryUrl };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred.', 'error');
            console.error(`[${this.requestId}] [TeslaBookmarksAdapter] An error occurred: ${error.message}`);
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

// --- PearlBookmarking Adapter ---
class PearlBookmarkingAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://pearlbookmarking.com/?success=1#tab-login';
        this.submitUrl = 'https://pearlbookmarking.com/index.php/submit-story/';
    }

    async publish() {
        this.log(`[EVENT] Entering PearlBookmarkingAdapter publish method.`);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Attempting chromium.launch()...');
            browser = await chromium.launch({ headless: false });
            this.log('[DEBUG] chromium.launch() completed.');
            this.log('[EVENT] Browser launched successfully.');
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(60000);

            // Step 1: Login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.');

            this.log('[EVENT] Filling login form...');
            await page.locator('input[name="log"]').fill(this.website.credentials.username);
            await page.locator('input[name="pwd"]').fill(this.website.credentials.password);
            this.log('[EVENT] Login form filled. Clicking login button...');
            
            await Promise.all([
                page.locator('input[type="submit"][name="wp-submit"]').click(),
                page.locator('#popup').waitFor({ state: 'hidden', timeout: 30000 }) // Wait for the login popup to be hidden
            ]);
            this.log('[EVENT] Login successful, popup hidden.');

            // Step 2: Navigate to submission page
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to submission page complete.');

            // Step 3: Fill submission form
            this.log('[EVENT] Filling submission form...');
            await page.locator('input[name="_story_url"]').fill(this.content.url || this.website.url);
            await page.locator('input[name="title"]').fill(this.content.title);
            await page.locator('select[name="story_category"]').selectOption({ value: '26' }); // Changed to 'Web Development'
            await page.locator('textarea[name="description"]').fill(this.content.body);
            this.log('[EVENT] Submission form filled. Clicking submit button...');

            // Step 4: Take screenshot before submission confirmation
            const preSubmissionScreenshotPath = `screenshot_presubmission_${this.requestId}.png`;
            await page.screenshot({ path: preSubmissionScreenshotPath, fullPage: true });
            this.log('[EVENT] Pre-submission screenshot taken.');
            const cloudinaryPreSubmissionUploadResult = await cloudinary.uploader.upload(preSubmissionScreenshotPath);
            const preSubmissionCloudinaryUrl = cloudinaryPreSubmissionUploadResult.secure_url;
            this.log(`[EVENT] Pre-submission screenshot uploaded to Cloudinary: ${preSubmissionCloudinaryUrl}`, 'info');
            fs.unlinkSync(preSubmissionScreenshotPath);

            // Add network logging for debugging the submission
            page.on('request', request => {
                this.log(`[NETWORK REQUEST] ${request.method()} ${request.url()}`, 'detail');
                if (request.postData()) {
                    this.log(`[NETWORK REQUEST PAYLOAD] ${request.postData()}`, 'detail');
                }
            });
            page.on('response', async response => {
                this.log(`[NETWORK RESPONSE] ${response.status()} ${response.url()}`, 'detail');
                try {
                    const responseBody = await response.text();
                    this.log(`[NETWORK RESPONSE BODY] ${responseBody.substring(0, 500)}...`, 'detail'); // Log first 500 chars
                } catch (e) {
                    this.log(`[NETWORK RESPONSE BODY ERROR] Could not read response body: ${e.message}`, 'detail');
                }
            });

            // Step 5: Submit the story
            await Promise.all([
                page.waitForResponse(response => response.url().includes('/submit-story/') && response.status() === 200),
                page.locator('input[type="submit"][name="submit"]').click()
            ]);
            this.log('[EVENT] Submit button clicked. Waiting for success message.');

            // Step 6: Confirm submission and take final screenshot
            const successMessageSelector = 'div.alert.alert-success';
            const alreadySubmittedMessageSelector = 'div.alert.alert-danger';
            let messageText = null;
            let isSuccess = false;

            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 15000 });
                messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Your story has been submitted. but your story is pending review.')) {
                    isSuccess = true;
                }
            } catch (error) {
                this.log(`[DEBUG] Primary success message not found, checking for already submitted message.`, 'detail');
            }

            if (!isSuccess) {
                try {
                    await page.waitForSelector(alreadySubmittedMessageSelector, { state: 'visible', timeout: 15000 });
                    messageText = await page.textContent(alreadySubmittedMessageSelector);
                    if (messageText && messageText.includes('The url is already been submitted, but this story is pending review.')) {
                        isSuccess = true; // Consider this a success as the URL is handled
                    }
                } catch (error) {
                    this.log(`[DEBUG] Already submitted message not found.`, 'detail');
                }
            }

            if (!isSuccess || !messageText) {
                const errorMessage = 'Submission confirmation message not found or not as expected.';
                this.log(`[ERROR] ${errorMessage}`, 'error');
                console.error(`[${this.requestId}] [PearlBookmarkingAdapter] ${errorMessage}`);
                throw new Error(errorMessage);
            }

            this.log(`[SUCCESS] Submission confirmation message: ${messageText}`, 'success');
            console.log(`[${this.requestId}] [PearlBookmarkingAdapter] ${messageText}`);

            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.');

            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'info');
            console.log(`[${this.requestId}] [PearlBookmarkingAdapter] Completion screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

            fs.unlinkSync(screenshotPath);

            return { success: true, message: messageText, preSubmissionScreenshot: preSubmissionCloudinaryUrl, postSubmissionScreenshot: cloudinaryUrl };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred.', 'error');
            console.error(`[${this.requestId}] [PearlBookmarkingAdapter] An error occurred: ${error.message}`);
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

// --- GainWeb Adapter ---
class GainWebAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://gainweb.org/submit.php';
    }

    async publish() {
        this.log(`[EVENT] Entering GainWebAdapter publish method.`);

        let browser;
        let context;
        let page;

        try {
            this.log('[DEBUG] Launching Chromium browser...');
            browser = await chromium.launch({ headless: false });
            this.log('[DEBUG] Chromium launched.');
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(60000);

            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.');

            // Step 1: Click radio button with value="2"
            this.log('[EVENT] Selecting radio button LINK_TYPE value=2');
            const radioButton = page.locator('input[type="radio"][name="LINK_TYPE"][value="2"]');
            await radioButton.check();

            // Step 2: Fill title
            this.log('[EVENT] Filling title input');
            const titleInput = page.locator('input#TITLE[name="TITLE"]');
            await titleInput.fill(this.content.title);

            // Step 3: Fill URL
            this.log('[EVENT] Filling URL input');
            const urlInput = page.locator('input#URL[name="URL"]');
            await urlInput.fill(this.content.url);

            // Step 4: Select category "Search Engine Optimization (SEO)"
            this.log('[EVENT] Selecting category "Search Engine Optimization (SEO)"');
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
                throw new Error('Category "Search Engine Optimization (SEO)" not found in select options.');
            }
            await categorySelect.selectOption(seoValue);

            // Step 5: Fill description
            this.log('[EVENT] Filling description textarea');
            const descriptionTextarea = page.locator('textarea#DESCRIPTION[name="DESCRIPTION"]');
            await descriptionTextarea.fill(this.content.body || '');

            // Step 6: Tick checkbox AGREERULES
            this.log('[EVENT] Checking checkbox AGREERULES');
            const agreeCheckbox = page.locator('input#AGREERULES[name="AGREERULES"]');
            await agreeCheckbox.check();

            // Step 7: Click submit button
            this.log('[EVENT] Clicking submit button');
            const submitButton = page.locator('input[type="submit"][name="continue"]');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                submitButton.click()
            ]);

            // Step 8: Verify submission message
            this.log('[EVENT] Verifying submission confirmation message');
            const confirmationSelector = 'td.colspan-2.msg, td[colspan="2"].msg';
            await page.waitForSelector(confirmationSelector, { timeout: 15000 });
            const confirmationText = await page.textContent(confirmationSelector);
            if (!confirmationText || !confirmationText.includes('Link submitted and awaiting approval')) {
                throw new Error('Submission confirmation message not found or incorrect.');
            }
            this.log(`[SUCCESS] Submission confirmed: ${confirmationText}`);

            // Step 9: Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.');

            // Step 10: Upload screenshot to Cloudinary
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);
            console.log(`[${this.requestId}] [GainWebAdapter] Screenshot URL: ${cloudinaryUrl}`);

            // Step 11: Log confirmation message to websocketLogger and console
            this.log(`[EVENT] Submission message: ${confirmationText}`);
            console.log(`[${this.requestId}] [GainWebAdapter] Submission message: ${confirmationText}`);

            // Clean up local screenshot file
            fs.unlinkSync(screenshotPath);

            return { success: true, message: confirmationText, screenshotUrl: cloudinaryUrl };

        } catch (error) {
            this.log(`[ERROR] GainWebAdapter error: ${error.message}`, 'error');
            console.error(`[${this.requestId}] [GainWebAdapter] Error: ${error.message}`);

            if (page) {
                const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                this.log(`[EVENT] Error screenshot taken: ${errorScreenshotPath}`);
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`);
                console.log(`[${this.requestId}] [GainWebAdapter] Error screenshot URL: ${errorCloudinaryResult.secure_url}`);
                fs.unlinkSync(errorScreenshotPath);
            }

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

// Add GainWebAdapter to adapterMap
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
    '../controllers/bookmarking/teslaBookmarksController.js': TeslaBookmarksAdapter,
    '../controllers/bookmarking/pearlBookmarkingController.js': PearlBookmarkingAdapter,
    'directory/gainweb': GainWebAdapter,
    'directory': GainWebAdapter
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
