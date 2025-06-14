import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

// Step 1: Login with Playwright and get cookies + hidden fields
const loginAndExtract = async (loginUrl, newPostUrl, username, password) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🔐 Logging in via Playwright...');
  await page.goto(loginUrl, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('input[type="submit"]'),
  ]);
  
  // Adding a timeout as seen in script.js to ensure page elements are loaded.
  await page.waitForTimeout(3000);

  console.log('✅ Logged in via Playwright, navigating to new post page...');
  await page.goto(newPostUrl, { waitUntil: 'networkidle' });
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
const postWithAxios = async (newPostUrl, cookies, hiddenInputs, title, content, postStatus = 'publish') => {
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.replace(/^\./, '')}`; // Ensure correct URL for cookie domain
    await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
  }

  const client = wrapper(axios.create({ jar }));

  const form = {
    ...hiddenInputs,
    post_title: title,
    content: content, // This assumes the content field is named 'content' on the form
    publish: 'Publish', // Assuming this is the name of the publish button/field
    post_status: postStatus, // Use the passed postStatus
  };

  const body = new URLSearchParams(form).toString();

  console.log('📤 Posting article via Axios...');
  const res = await client.post(newPostUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  // Attempt to extract post URL from response data
  // This regex might need adjustment based on the actual success page HTML
  const match = res.data.match(/href="(https?:\/\/[^\"]+\/automated-post[^\"]+)"/i);
  const finalUrl = match ? match[1] : null;

  console.log(finalUrl ? `✅ Post URL: ${finalUrl}` : '❌ Post URL not found in response.');
  return finalUrl;
};

// Controller function for the /auto-post route
const createPost = async (req, res) => {
  // Extract parameters from request body
  const { loginUrl, newPostUrl, username, password, title, content, postStatus } = req.body;

  // Basic validation
  if (!loginUrl || !newPostUrl || !username || !password || !title || !content) {
    return res.status(400).json({ success: false, error: 'Missing one or more required parameters in request body.' });
  }

  try {
    console.log('Starting automated post process with provided parameters...');
    const { cookies, hiddenInputs } = await loginAndExtract(loginUrl, newPostUrl, username, password);
    const postUrl = await postWithAxios(newPostUrl, cookies, hiddenInputs, title, content, postStatus);

    if (postUrl) {
      res.json({ success: true, postUrl: postUrl });
    } else {
      res.status(500).json({ success: false, error: 'Failed to publish post or retrieve URL.' });
    }

  } catch (error) {
    console.error('❌ Error during automation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export { createPost }; 