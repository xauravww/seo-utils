import { Router } from 'express';
import { chromium } from 'playwright';

const router = Router();

router.post('/publish', async (req, res) => {
  const { email, password, title, content } = req.body;

  if (!email || !password || !title || !content) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      permissions: ['geolocation'],
    });

    const page = await context.newPage();

    // Stealth anti-bot detection patches
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      window.chrome = {
        runtime: {},
      };
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3],
      });
    });

    // Debugging
    page.on('request', request =>
      console.log(`[REQUEST]  | ${request.method().padEnd(7)} | ${request.url()}`)
    );
    page.on('response', response =>
      console.log(`[RESPONSE] | ${response.status().toString().padEnd(7)} | ${response.url()}`)
    );
    page.on('console', msg =>
      console.log(`[CONSOLE]  | ${msg.type().toUpperCase()} | ${msg.text()}`)
    );

    // Step 1: Login
    await page.goto('https://www.bloglovin.com/login', { waitUntil: 'networkidle' });

    await page.fill('input[name="login_email"]', email);
    await page.fill('input[name="login_password"]', password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }),
      page.click('input[type="submit"]'),
    ]);

    // Verify login
    if (!page.url().startsWith('https://www.bloglovin.com/')) {
      throw new Error('Login failed — check credentials or site updated');
    }

    // Step 2: Navigate to post creation
    await page.goto('https://www.bloglovin.com/new-post', { waitUntil: 'networkidle' });

    // Step 3: Fill in post title and content
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 10000 });

    const editableFields = await page.$$('div[contenteditable="true"]');
    if (editableFields.length < 2) {
      throw new Error('Editor fields not found.');
    }

    const [titleField, contentField] = editableFields;

    await titleField.click();
    await titleField.type(title, { delay: 30 });

    await contentField.click();
    await contentField.type(content, { delay: 30 });

    // Step 4: Click publish button
    await page.click('.post-editor-publish-btn-icon');

    // Step 5: Wait for and click final Post button
    await page.waitForSelector('.post-editor-dropdown >> text=Post', { timeout: 5000 });
    await page.click('.post-editor-dropdown >> text=Post');

    // Step 6: Wait for successful post redirect
    await page.waitForURL(/https:\/\/www\.bloglovin\.com\/@[^/]+\/[^/]+-\d+/, {
      timeout: 10000,
    });

    const postedUrl = page.url();

    await browser.close();
    return res.json({ success: true, url: postedUrl });
  } catch (error) {
    console.error('❌ Failed to publish blog post:', error);
    if (browser) await browser.close();
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
