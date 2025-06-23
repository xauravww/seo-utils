import { parentPort, workerData } from 'worker_threads';
import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';

const { loginUrl, newPostUrl, username, password, title, content } = workerData;

// Helper to send status updates back to the main thread
const sendStatus = (message) => {
    parentPort.postMessage({ type: 'status', message });
};

const loginAndExtract = async () => {
    let browser;
    sendStatus(`[Worker] Launching browser for login at ${loginUrl}`);
    try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);

        sendStatus(`[Worker] Navigating to login page...`);
        await page.goto(loginUrl, { waitUntil: 'networkidle' });

        const usernameLocator = page.locator('input[name="username"], input[name="usr"]');
        const passwordLocator = page.locator('input[name="password"], input[name="pass"]');
        await usernameLocator.fill(username);
        await passwordLocator.fill(password);
        
        sendStatus('[Worker] Credentials filled. Clicking submit...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('input[type="submit"], button[type="submit"], #wp-submit')
        ]);

        sendStatus('[Worker] Logged in. Navigating to new post page to extract data...');
        await page.goto(newPostUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('form[id="post"]');

        const cookies = await context.cookies();
        const hiddenInputs = await page.$$eval('form[id="post"] input[type="hidden"]', inputs =>
            inputs.reduce((obj, el) => {
                obj[el.name] = el.value;
                return obj;
            }, {})
        );
        
        return { cookies, hiddenInputs };
    } finally {
        if (browser) {
            await browser.close();
            sendStatus(`[Worker] Browser closed after extraction.`);
        }
    }
};

const postWithAxios = async (cookies, hiddenInputs) => {
    sendStatus('[Worker] Posting article with extracted session data...');
    const jar = new CookieJar();
    for (const cookie of cookies) {
        const url = `https://${cookie.domain.replace(/^\./, '')}`;
        await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
    }

    const client = wrapper(axios.create({ jar }));

    const form = { ...hiddenInputs, post_title: title, content: content, publish: 'Publish' };
    const body = new URLSearchParams(form).toString();

    const postRes = await client.post(newPostUrl, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    
    const $ = load(postRes.data);
    const postUrl = $('#message a').attr('href') || $('.updated a').attr('href') || $('#sample-permalink a').attr('href');

    if (!postUrl) {
        throw new Error('Could not find the final post URL in the response page.');
    }
    return postUrl;
};

async function run() {
    try {
        const { cookies, hiddenInputs } = await loginAndExtract();
        const postUrl = await postWithAxios(cookies, hiddenInputs);
        parentPort.postMessage({ type: 'result', success: true, postUrl });
    } catch (error) {
        parentPort.postMessage({ type: 'result', success: false, error: error.message });
    }
}

run(); 