import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import { log } from '../websocketLogger.js';
import crypto from 'crypto';

const loginAndExtract = async (loginUrl, newPostUrl, username, password, requestId) => {
  console.log(`[${requestId}] Starting loginAndExtract for ${loginUrl}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  log(requestId, { message: `🔐 Logging in to ${loginUrl}...`, url: loginUrl });
  console.log(`[${requestId}] Navigating to login page: ${loginUrl}/login`);
  await page.goto(loginUrl+"/login");
  await page.fill('input[name="username"], input[name="usr"]', username);
  await page.fill('input[name="password"], input[name="pass"]', password);
  console.log(`[${requestId}] Filled login credentials for ${loginUrl}`);
  await page.click('input[type="submit"]');

  await page.waitForTimeout(3000);

  log(requestId, { message: '✅ Logged in, navigating to new post page...', url: loginUrl });
  console.log(`[${requestId}] Navigating to new post page: ${newPostUrl}`);
  await page.goto(newPostUrl);
  await page.waitForSelector('input[name="post_title"]');
  console.log(`[${requestId}] On new post page for ${loginUrl}`);

  const cookies = await context.cookies();
  console.log(`[${requestId}] Extracted ${cookies.length} cookies.`);

  const hiddenInputs = await page.$$eval('form input[type="hidden"]', inputs =>
    inputs.reduce((obj, el) => {
      obj[el.name] = el.value;
      return obj;
    }, {})
  );
  console.log(`[${requestId}] Extracted ${Object.keys(hiddenInputs).length} hidden inputs.`);

  await browser.close();
  console.log(`[${requestId}] Browser closed for ${loginUrl}`);
  return { cookies, hiddenInputs };
};

const postWithAxios = async (newPostUrl, cookies, hiddenInputs, title, content, requestId, loginUrl) => {
  console.log(`[${requestId}] Starting postWithAxios for ${newPostUrl}`);
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.replace(/^\./, '')}`;
    await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
  }

  const client = wrapper(axios.create({ jar }));
  console.log(`[${requestId}] Axios client created with cookie jar.`);

  const form = {
    ...hiddenInputs,
    post_title: title,
    content: content,
    publish: 'Publish',
    post_status: 'draft',
  };

  const body = new URLSearchParams(form).toString();
  console.log(`[${requestId}] Prepared form data for posting to ${newPostUrl}`);

  log(requestId, { message: `📤 Posting article to ${newPostUrl}...`, url: loginUrl });
  const postRes = await client.post(newPostUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  console.log(`[${requestId}] Post request to ${newPostUrl} completed with status ${postRes.status}`);

  const $ = load(postRes.data);
  let finalUrl = $('#successfully_posted_url a').attr('href');
  if (!finalUrl) {
    finalUrl = $('#published-url a').attr('href');
  }
  console.log(`[${requestId}] Extracted post URL: ${finalUrl}`);

  log(requestId, {
      message: finalUrl ? `✅ Post URL found: ${finalUrl}` : `❌ Post URL not found on ${newPostUrl}.`,
      url: loginUrl
  });
  return finalUrl;
};

export const createPost = (req, res) => {
    const { title, content, username, password, urls } = req.body;
    const requestId = crypto.randomUUID();
    console.log(`[${requestId}] Received request to create post. URLs:`, urls);
  
    if (!title || !content || !username || !password || !urls || !Array.isArray(urls) || urls.length === 0) {
      console.error(`[${requestId}] Bad request: Missing required fields.`);
      return res.status(400).json({ error: 'Missing required fields. Make sure to provide title, content, username, password, and a non-empty array of urls.' });
    }
  
    res.status(202).json({ 
      message: 'Request accepted. Use the requestId to connect to the log stream.',
      requestId: requestId
    });
    console.log(`[${requestId}] Responded 202 Accepted. Starting background processing.`);

    const runInBackground = async () => {
      const processSingleUrl = async (loginUrl) => {
        try {
          const urlObject = new URL(loginUrl);
          const pathParts = urlObject.pathname.split('/');
          pathParts.pop();
          pathParts.push('new-post');
          urlObject.pathname = pathParts.join('/');
          const newPostUrl = urlObject.href;
          console.log(`[${requestId}] Constructed new post URL for ${loginUrl}: ${newPostUrl}`);
    
          const { cookies, hiddenInputs } = await loginAndExtract(loginUrl, newPostUrl, username, password, requestId);
          const postUrl = await postWithAxios(newPostUrl, cookies, hiddenInputs, title, content, requestId, loginUrl);

          if (postUrl) {
            const result = { success: true, postUrl, loginUrl };
            log(requestId, { ...result, message: `✅ Success for ${loginUrl}` });
            console.log(`[${requestId}] Successfully processed ${loginUrl}. Post URL: ${postUrl}`);
            return result;
          } else {
            const result = { success: false, message: 'Failed to create post.', loginUrl };
            log(requestId, { ...result, message: `❌ Failure for ${loginUrl}: No post URL returned.` });
            console.warn(`[${requestId}] Failed to process ${loginUrl}: No post URL returned.`);
            return result;
          }
        } catch (error) {
          console.error(`Error during automated posting for ${loginUrl}:`, error);
          const result = { success: false, message: 'An error occurred during automated posting.', error: error.message, loginUrl };
          log(requestId, { ...result, message: `❌ Error for ${loginUrl}: ${error.message}` });
          return result;
        }
      };

      const CONCURRENCY_LIMIT = 2;
      const queue = [...urls];
      const results = [];

      log(requestId, { message: `🚀 Initializing... Processing ${urls.length} URLs with concurrency ${CONCURRENCY_LIMIT}.` });
      console.log(`[${requestId}] Starting concurrent processing of ${urls.length} URLs with a limit of ${CONCURRENCY_LIMIT}.`);

      const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
          while (queue.length > 0) {
              const url = queue.shift();
              if (url) {
                  const result = await processSingleUrl(url);
                  results.push(result);
              }
          }
      });
      
      try {
        await Promise.all(workers);
        log(requestId, { message: '✅ All processing finished.', finalResults: results });
        console.log(`[${requestId}] All URLs processed. Final results:`, results);
      } catch(error) {
         console.error('An unexpected error occurred while processing posts:', error);
         log(requestId, { success: false, message: 'An unexpected error occurred while processing posts.', error: error.message });
      }
    };

    runInBackground();
  };