import { chromium } from 'playwright';
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
    async publish() {
        this.log('[DEBUG] PingMyLinksAdapter.publish() entered.');
        this.log('[EVENT] Entering PingMyLinksAdapter publish method.');
        
        let browser;
        try {
            this.log('[DEBUG] Attempting chromium.launch()...');
            browser = await chromium.launch({ headless: false }); // Changed to headless: false for debugging
            this.log('[DEBUG] chromium.launch() completed.');
            this.log('[EVENT] Browser launched successfully.');
            const context = await browser.newContext();
            const page = await context.newPage();

            // Take screenshot at the beginning and upload to Cloudinary
            const screenshotPath = `screenshot_start_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken.');

            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUploadResult.secure_url}`, 'info');
            console.log(`[EVENT] Screenshot uploaded to Cloudinary: ${cloudinaryUploadResult.secure_url}`);

            // You can also delete the local screenshot file after upload if desired
            fs.unlinkSync(screenshotPath);

            this.log('[EVENT] Setting up page event listeners.');
            page.on('request', request => {
              // this.log('[EVENT] Network request sent', 'detail'); // Removed
              // console.log('[EVENT] Network request sent'); // Removed
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
                    // this.log(`Successfully pinged to this website: ${pingedUrl}`, 'info'); // Removed
                    // console.log(`Successfully pinged to this website: ${pingedUrl}`); // Removed
                }
              }
              // this.log('\n--- [REQUEST SENT] ---', 'detail'); // Removed
              // console.log('\n--- [REQUEST SENT] ---'); // Removed
              // this.log(curlCommand, 'detail'); // Removed
              // console.log(curlCommand); // Removed
              // this.log('----------------------\n', 'detail'); // Removed
              // console.log('----------------------\n'); // Removed
            });
          
            page.on('response', async response => {
              // this.log('[EVENT] Network response received', 'detail'); // Removed
              // console.log('[EVENT] Network response received'); // Removed

              // Check if the response is from api.php and log its body
              if (response.url().includes('api.php')) {
                try {
                  const responseBody = await response.text();
                  this.log(`Successfully pinged to this website: ${responseBody}`, 'info'); // Keep
                  console.log(`Successfully pinged to this website: ${responseBody}`, 'info'); // Keep
                } catch (e) {
                  this.log(`Error reading API.PHP response body: ${e.message}`, 'error'); // Keep
                  console.error(`Error reading API.PHP response body: ${e.message}`); // Keep
                }
              }

              // Existing detailed logging for all responses - Removed these
              // this.log(`\n--- [RESPONSE RECEIVED] ---`, 'detail');
              // console.log(`\n--- [RESPONSE RECEIVED] ---`);
              // this.log(`STATUS: ${response.status()} ${response.statusText()}`, 'detail');
              // console.log(`STATUS: ${response.status()} ${response.statusText()}`);
              // this.log(`URL: ${response.url()}`, 'detail');
              // console.log(`URL: ${response.url()}`);

              // Adding response headers to console output - Removed these
              // const headers = response.headers();
              // this.log('HEADERS:', 'detail');
              // console.log('HEADERS:');
              // for (const key in headers) {
              //   this.log(`  ${key}: ${headers[key]}`, 'detail');
              //   console.log(`  ${key}: ${headers[key]}`);
              // }

              // this.log(`---------------------------\n`, 'detail');
              // console.log(`---------------------------\n`);
            });

            page.on('pageerror', error => {
                // this.log('[EVENT] Page error occurred', 'error'); // Removed
                // console.log('[EVENT] Page error occurred'); // Removed
                // this.log(`[ERROR] Page error: ${error.message}`, 'error'); // Removed
                // console.error(`[ERROR] Page error: ${error.message}`); // Removed
            });

            page.on('console', msg => {
                // this.log(`[EVENT] Console message: ${msg.type()} - ${msg.text()}`, 'detail'); // Removed
                // console.log(`[EVENT] Console message: ${msg.type()} - ${msg.text()}`); // Removed
            });

            this.log('[EVENT] Navigating to target page...');
            await page.goto('https://www.pingmylinks.com/googleping/', { timeout: 60000 });
            this.log('[EVENT] Navigation complete.');

            this.log('[EVENT] Locating URL input field...');
            const furlInput = page.locator('#furl');
            try {
                await furlInput.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Filling URL input field...');
                // Use the URL from this.website.url
                await furlInput.fill(this.website.url);
                this.log('[EVENT] URL input field filled.');
            } catch (error) {
                this.log(`[ERROR] Failed to locate or fill URL input field: ${error.message}`, 'error');
                await page.screenshot({ path: `${this.requestId}-furl-input-error-screenshot.png` });
                this.log(`[EVENT] Screenshot saved as ${this.requestId}-furl-input-error-screenshot.png`);
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
                await page.screenshot({ path: `${this.requestId}-submit-button-error-screenshot.png` });
                this.log(`[EVENT] Screenshot saved as ${this.requestId}-submit-button-error-screenshot.png`);
                throw error;
            }

            this.log('[EVENT] Waiting for submission completion message (indefinitely)...');
            const successMessageSelector = 'div.messageok';
            try {
                await page.waitForSelector(successMessageSelector, { state: 'visible', timeout: 0 }); // Wait indefinitely
                const messageText = await page.textContent(successMessageSelector);
                if (messageText && messageText.includes('Submission Complete!')) {
                    this.log(`[SUCCESS] Submission Complete! Message: ${messageText}`, 'success');
                } else {
                    this.log(`[WARNING] Submission Complete message found, but text is not as expected: ${messageText}`, 'warning');
                }
            } catch (error) {
                this.log(`[ERROR] Failed to find submission complete message: ${error.message}`, 'error');
                await page.screenshot({ path: `${this.requestId}-submission-error-screenshot.png` });
                this.log(`[EVENT] Screenshot saved as ${this.requestId}-submission-error-screenshot.png`);
                throw error; // Re-throw to indicate failure
            }

            this.log('[SUCCESS] Script finished successfully. The browser will remain open for inspection.', 'success');
            return { success: true };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error');
            this.log(`[ERROR] Global script error: ${error.message}`, 'error');
            this.log('----------------------', 'error');
            this.log('[EVENT] An error occurred. The browser will remain open for debugging.', 'error');
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


// --- Add other Adapters here (e.g., LinkedInAdapter) ---


// --- Adapter Factory ---
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
    '../controllers/ping/pingMyLinksController.js': PingMyLinksAdapter, // Assuming this is the correct path for the new controller
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