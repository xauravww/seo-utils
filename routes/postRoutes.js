import { Router } from 'express';
import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';

const router = Router();

const createPost = async (req, res) => {
  const { title, content, username, password, loginUrl, newPostUrl } = req.body;

  if (!title || !content || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields: title, content, username, or password.' });
  }

  const LOGIN_URL = loginUrl || 'https://uzblog.net/login';
  const NEW_POST_URL = newPostUrl || 'https://uzblog.net/new-post';

  // Step 1: Login with Playwright and get cookies + hidden fields
  const loginAndExtract = async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('🔐 Logging in...');
    await page.goto(LOGIN_URL);
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('input[type="submit"]');

    await page.waitForTimeout(3000);

    console.log('✅ Logged in, navigating to new post page...');
    await page.goto(NEW_POST_URL);
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

  // Step 2: Use Axios with cookies to submit a new post
  const postWithAxios = async (cookies, hiddenInputs) => {
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

    console.log('📤 Posting article...');
    const postRes = await client.post(NEW_POST_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    console.log(postRes.data)

    // Extract post URL from response
    const $ = load(postRes.data);
    const finalUrl = $('#successfully_posted_url a').attr('href');

    console.log(finalUrl ? `✅ Post URL: ${finalUrl}` : '❌ Post URL not found.');
    return finalUrl;
  };

  try {
    const { cookies, hiddenInputs } = await loginAndExtract();
    const postUrl = await postWithAxios(cookies, hiddenInputs);
    if (postUrl) {
      res.status(200).json({ success: true, postUrl });
    } else {
      res.status(500).json({ success: false, message: 'Failed to create post.' });
    }
  } catch (error) {
    console.error('Error during automated posting:', error);
    res.status(500).json({ success: false, message: 'An error occurred during automated posting.', error: error.message });
  }
};

// POST route for creating a new post
router.post('/auto-post', createPost);

export default router; 