import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../websocketLogger.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const CONCURRENCY_LIMIT = 2;

const loginAndExtract = async (loginUrl, newPostUrl, username, password) => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  console.log(`🔐 Logging in to ${loginUrl}...`);
  await page.goto(loginUrl+"/login");
  await page.fill('input[name="username"], input[name="usr"]', username);
  await page.fill('input[name="password"], input[name="pass"]', password);
  await page.click('input[type="submit"]');

  await page.waitForTimeout(3000);

  console.log('✅ Logged in, navigating to new post page...');
  await page.goto(newPostUrl);
  await page.waitForSelector('input[name="post_title"]');

  const cookies = await context.cookies();

  // Extract all hidden input fields required for the post
  const hiddenInputs = await page.$$eval('form input[type="hidden"]', inputs =>
    inputs.reduce((obj, el) => {
      obj[el.name] = el.value;
      return obj;
    }, {})
  );

  await browser.close();
  return { cookies, hiddenInputs };
};

const postWithAxios = async (newPostUrl, cookies, hiddenInputs, title, content) => {
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.replace(/^\./, '')}`;
    await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
  }

  const client = wrapper(axios.create({ jar }));

  const form = {
    ...hiddenInputs,
    post_title: title,
    content: content,
    publish: 'Publish',
    post_status: 'draft',
  };

  const body = new URLSearchParams(form).toString();

  console.log(`📤 Posting article to ${newPostUrl}...`);
  const postRes = await client.post(newPostUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  console.log(postRes.data)

  // Extract post URL from response
  const $ = load(postRes.data);
  let finalUrl = $('#successfully_posted_url a').attr('href');
  if (!finalUrl) {
    finalUrl = $('#published-url a').attr('href');
  }

  console.log(finalUrl ? `✅ Post URL: ${finalUrl}` : `❌ Post URL not found on ${newPostUrl}.`);
  return finalUrl;
};

export const createPost = (req, res) => {
  const { title, content, username, password, urls } = req.body;
  const requestId = crypto.randomUUID();

  if (!title || !content || !username || !password || !urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  
  // Immediately respond with the requestId
  res.status(202).json({ 
    message: 'Request accepted. Use the requestId to connect to the log stream.',
    requestId: requestId
  });

  // --- Run the actual process in the background ---
  const runInBackground = () => {
    const workerPath = path.resolve(path.dirname(__filename), '..', 'wpWorker.js');
    log(requestId, `🚀 Starting WordPress post creation for ${urls.length} sites. Concurrency: ${CONCURRENCY_LIMIT}.`);

    const results = [];
    const queue = [...urls];
    let activeWorkers = 0;
    
    const manageWorkers = () => {
      if (queue.length === 0 && activeWorkers === 0) {
        log(requestId, `✅ All WordPress posts processed. Final results: ${JSON.stringify(results)}`);
        return;
      }

      while (activeWorkers < CONCURRENCY_LIMIT && queue.length > 0) {
        activeWorkers++;
        const url = queue.shift();
        log(requestId, `⏳ Processing site: ${url}`);
        
        const worker = new Worker(workerPath, {
          workerData: { loginUrl: `${url}/login`, newPostUrl: `${url}/new-post`, username, password, title, content }
        });

        worker.on('message', (message) => {
          if (message.type === 'status') {
            log(requestId, message.message);
          } else if (message.type === 'result') {
            if (message.success) {
              log(requestId, `✅ Successfully posted to ${url}: ${message.postUrl}`);
            } else {
              log(requestId, `❌ Failed to post to ${url}: ${message.error}`);
            }
            results.push({ url, ...message });
          }
        });

        worker.on('error', (error) => {
          log(requestId, `❌ Worker error for ${url}: ${error.message}`);
          results.push({ url, success: false, error: error.message });
          activeWorkers--;
          manageWorkers();
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            if (!results.some(r => r.url === url && r.error)) {
                const errorMessage = `Worker for ${url} stopped with exit code ${code}`;
                log(requestId, `❌ ${errorMessage}`);
                results.push({ url, success: false, error: errorMessage });
            }
          }
          activeWorkers--;
          manageWorkers();
        });
      }
    };

    try {
      log(requestId, 'Initializing worker pool...');
      manageWorkers();
    } catch (error) {
      log(requestId, `An unexpected error occurred in the main controller: ${error.message}`);
    }
  };

  runInBackground();
}; 