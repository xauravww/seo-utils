import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';

const loginAndExtract = async (loginUrl, newPostUrl, username, password) => {
  const browser = await chromium.launch({ headless: true });
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

  // Extract post URL from response
  const $ = load(postRes.data);
  let finalUrl = $('#successfully_posted_url a').attr('href');
  if (!finalUrl) {
    finalUrl = $('#published-url a').attr('href');
  }

  return finalUrl;
};

export const createPost = async (req, res) => {
    const { title, content, username, password, urls } = req.body;
  
    if (!title || !content || !username || !password || !urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Missing required fields. Make sure to provide title, content, username, password, and a non-empty array of urls.' });
    }
  
    const processSingleUrl = async (loginUrl) => {
      try {
        const urlObject = new URL(loginUrl);
        const pathParts = urlObject.pathname.split('/');
        pathParts.pop(); // Remove the last part (e.g., 'login')
        pathParts.push('new-post');
        urlObject.pathname = pathParts.join('/');
        const newPostUrl = urlObject.href;
  
        const { cookies, hiddenInputs } = await loginAndExtract(loginUrl, newPostUrl, username, password);
        const postUrl = await postWithAxios(newPostUrl, cookies, hiddenInputs, title, content);
        if (postUrl) {
          return { success: true, postUrl, loginUrl };
        } else {
          return { success: false, message: 'Failed to create post.', loginUrl };
        }
      } catch (error) {
        console.error(`Error during automated posting for ${loginUrl}:`, error);
        return { success: false, message: 'An error occurred during automated posting.', error: error.message, loginUrl };
      }
    };

    const CONCURRENCY_LIMIT = 2;
    const queue = [...urls];
    const results = [];

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
      res.status(200).json({ results });
    } catch(error) {
       console.error('An unexpected error occurred while processing posts:', error);
       res.status(500).json({ success: false, message: 'An unexpected error occurred while processing posts.' });
    }
  }; 