import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import * as websocketLogger from './websocketLogger.js';
import { getControllerForWebsite } from './websiteClassifier.js';

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
        console.log(`[${this.requestId}] [WordPressAdapter] Launching browser for ${this.website.url}`);
        try {
            browser = await chromium.launch({ headless: false });
            const context = await browser.newContext({ ignoreHTTPSErrors: true });
            const page = await context.newPage();
            page.setDefaultTimeout(60000);

            // Construct the standard WordPress login URL and navigate there directly.
            const loginUrl = `${this.website.url.replace(/\/$/, '')}/login`;
            this.log(`Navigating to login page: ${loginUrl}`);
            console.log(`[${this.requestId}] [WordPressAdapter] Navigating to login page: ${loginUrl}`);
            await page.goto(loginUrl, { waitUntil: 'networkidle' });

            // Add the user's provided selectors to make the locator more robust.
            const usernameLocator = page.locator('input[name="username"], input[name="user_login"], input[name="log"], input[name="usr"]');
            const passwordLocator = page.locator('input[name="password"], input[name="user_pass"], input[name="pwd"], input[name="pass"]');
            // Use credentials from the website object
            await usernameLocator.fill(this.website.credentials.username);
            await passwordLocator.fill(this.website.credentials.password);
            console.log(`[${this.requestId}] [WordPressAdapter] Credentials filled for ${this.website.url}`);
            
            this.log('Credentials filled. Clicking submit...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle' }),
                page.click('input[type="submit"], button[type="submit"], #wp-submit')
            ]);
            
            const newPostUrl = `${this.website.url.replace(/\/$/, '')}/new-post`;
            this.log(`Logged in. Navigating to new post page: ${newPostUrl}`);
            console.log(`[${this.requestId}] [WordPressAdapter] Navigating to new post page: ${newPostUrl}`);
            await page.goto(newPostUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('form[id="post"]', { timeout: 15000 });

            const cookies = await context.cookies();
            console.log(`[${this.requestId}] [WordPressAdapter] Extracted ${cookies.length} cookies.`);
            const hiddenInputs = await page.$$eval('form[id="post"] input[type="hidden"]', inputs =>
                inputs.reduce((obj, el) => {
                    obj[el.name] = el.value;
                    return obj;
                }, {})
            );
            console.log(`[${this.requestId}] [WordPressAdapter] Extracted ${Object.keys(hiddenInputs).length} hidden inputs.`);
            
            this.log(`Extracted ${cookies.length} cookies and ${Object.keys(hiddenInputs).length} hidden inputs.`, 'info');
            return { cookies, hiddenInputs, newPostUrl };
        } finally {
            if (browser) {
                await browser.close();
                this.log(`Browser closed after extraction.`);
                console.log(`[${this.requestId}] [WordPressAdapter] Browser closed for ${this.website.url}`);
            }
        }
    }

    async postWithAxios(cookies, hiddenInputs, newPostUrl) {
        this.log('Posting article with extracted session data...');
        console.log(`[${this.requestId}] [WordPressAdapter] Starting postWithAxios for ${newPostUrl}`);
        const jar = new CookieJar();
        for (const cookie of cookies) {
            const url = `https://${cookie.domain.replace(/^\./, '')}`;
            await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
        }

        const client = wrapper(axios.create({ jar }));

        const form = { ...hiddenInputs, post_title: this.content.title, content: this.content.body, publish: 'Publish' };
        const body = new URLSearchParams(form).toString();
        console.log(`[${this.requestId}] [WordPressAdapter] Form data prepared for posting.`);

        const postRes = await client.post(newPostUrl, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        console.log(`[${this.requestId}] [WordPressAdapter] Post request to ${newPostUrl} completed with status ${postRes.status}`);
        
        const $ = load(postRes.data);
        // Add the user's recommended selectors to the list for robust URL detection.
        const postUrl = $('#message a').attr('href') || 
                        $('.updated a').attr('href') || 
                        $('#sample-permalink a').attr('href') ||
                        $('#successfully_posted_url a').attr('href') ||
                        $('#published-url a').attr('href') ||
                        $('.post-publish-panel__postpublish-post-address').attr('href');

        if (!postUrl) {
            this.log('Failed to find post URL in response. The page HTML will be logged for debugging.', 'error');
            console.error(`[${this.requestId}] [WordPressAdapter] Failed to find post URL in response for ${newPostUrl}.`);
            console.log(`[${this.requestId}] [WordPressAdapter] ----- START SERVER RESPONSE for ${newPostUrl} -----`);
            console.log(postRes.data);
            console.log(`[${this.requestId}] [WordPressAdapter] ----- END SERVER RESPONSE for ${newPostUrl} -----`);
            // Log a snippet of the response to help identify the correct selector.
            const responseSnippet = postRes.data.substring(0, 3000); // Limit snippet size
            this.log(`--- Start of Response HTML Snippet ---\n${responseSnippet}\n--- End of Response HTML Snippet ---`, 'detail');
            throw new Error('Could not find the final post URL in the response page. Check logs for HTML snippet.');
        }
        
        this.log(`Successfully extracted post URL: ${postUrl}`, 'success');
        console.log(`[${this.requestId}] [WordPressAdapter] Successfully extracted post URL: ${postUrl}`);
        return postUrl;
    }

    async publish() {
        this.log(`Starting WordPress publication for ${this.website.url}`, 'info');
        console.log(`[${this.requestId}] [WordPressAdapter] Starting publication for ${this.website.url}`);
        try {
            const { cookies, hiddenInputs, newPostUrl } = await this.loginAndExtract();
            const postUrl = await this.postWithAxios(cookies, hiddenInputs, newPostUrl);
            this.log(`Publication successful! URL: ${postUrl}`, 'success');
            console.log(`[${this.requestId}] [WordPressAdapter] Publication successful for ${this.website.url}. URL: ${postUrl}`);
            return { success: true, postUrl };
        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error');
            console.error(`[${this.requestId}] [WordPressAdapter] Publication failed for ${this.website.url}:`, error); // Also log the full error to the server console
            return { success: false, error: error.message };
        }
    }
}

// --- Add other Adapters here (e.g., LinkedInAdapter) ---


// --- Adapter Factory ---
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
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