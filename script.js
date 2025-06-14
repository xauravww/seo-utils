import { chromium } from 'playwright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const LOGIN_URL = 'https://uzblog.net/login';
const NEW_POST_URL = 'https://uzblog.net/new-post';
const USERNAME = 'eric98123';
const PASSWORD = 'Lover@123';
const TITLE = 'Automated Post via Bot';
const CONTENT = '🚀 This post is created by a bot using Playwright + Axios.';

// Step 1: Login with Playwright and get cookies + hidden fields
const loginAndExtract = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🔐 Logging in...');
  await page.goto(LOGIN_URL);
  await page.fill('input[name="username"]', USERNAME);
  await page.fill('input[name="password"]', PASSWORD);
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
    post_title: TITLE,
    content: CONTENT,
    publish: 'Publish',
    post_status: 'draft',
  };

  const body = new URLSearchParams(form).toString();

  console.log('📤 Posting article...');
  const res = await client.post(NEW_POST_URL, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  // Extract post URL from response
  const match = res.data.match(/href="(https:\/\/[^"]+\/automated-post[^"]+)"/i);
  const finalUrl = match ? match[1] : null;

  console.log(finalUrl ? `✅ Post URL: ${finalUrl}` : '❌ Post URL not found.');
  return finalUrl;
};

// Main runner
const main = async () => {
  const { cookies, hiddenInputs } = await loginAndExtract();
  const postUrl = await postWithAxios(cookies, hiddenInputs);
  return postUrl;
};

main();
