// Playwright-based Express server for Cloudflare bypass API
import express from 'express';
import { chromium } from 'playwright';
import minimist from 'minimist';
import { KameleoLocalApiClient } from '@kameleo/local-api-client';
import { setTimeout as sleep } from 'timers/promises';
// The global URL class is available in ESM, no need to import from 'url'

const app = express();
const args = minimist(process.argv.slice(2));
const PORT = process.env.SERVER_PORT || 8000;
const DOCKER_MODE = process.env.DOCKERMODE === 'true';
const HEADLESS = args.headless || DOCKER_MODE;
const LOG = !args.nolog;

// Kameleo integration helpers
const kameleoPort = process.env["KAMELEO_PORT"] || 5050;
const kameleoCliUri = `http://localhost:${kameleoPort}`;
const kameleoClient = new KameleoLocalApiClient({ basePath: kameleoCliUri });

async function createKameleoProfile() {
  // Get a Chrome desktop fingerprint
  const fingerprints = await kameleoClient.fingerprint.searchFingerprints("desktop", undefined, "chrome");
  if (!fingerprints.length) throw new Error('No Kameleo fingerprints found');
  const createProfileRequest = {
    fingerprintId: fingerprints[0].id,
    name: "Express-Playwright-Kameleo integration",
  };
  const profile = await kameleoClient.profile.createProfile(createProfileRequest);
  await kameleoClient.profile.startProfile(profile.id);
  return profile;
}

async function launchBrowserWithKameleo() {
  const profile = await createKameleoProfile();
  const browserWSEndpoint = `ws://localhost:${kameleoPort}/playwright/${profile.id}`;
  const browser = await chromium.connectOverCDP(browserWSEndpoint);
  return { browser, profileId: profile.id };
}

async function closeKameleoProfile(profileId) {
  try {
    await kameleoClient.profile.stopProfile(profileId);
  } catch (e) {
    // Ignore errors on cleanup
  }
}

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    // Block localhost, private IPs, file://
    if (
      ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname) ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname) ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      parsed.protocol === 'file:'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function launchBrowser(proxy) {
  let launchOptions = {
    headless: HEADLESS,
    args: [
      '--no-first-run',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--password-store=basic',
      '--use-mock-keychain',
      '--export-tagged-pdf',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--enable-features=NetworkService,NetworkServiceInProcess,LoadCryptoTokenExtension,PermuteTLSExtensions',
      '--disable-features=FlashDeprecationWarning,EnablePasswordsAccountStorage',
      '--deny-permission-prompts',
      '--disable-gpu',
      '--lang=en-US'
    ]
  };
  if (proxy) {
    // proxy format: http://user:pass@host:port or http://host:port
    launchOptions.proxy = {};
    const proxyUrl = new URL(proxy);
    launchOptions.proxy.server = `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`;
    if (proxyUrl.username && proxyUrl.password) {
      launchOptions.proxy.username = proxyUrl.username;
      launchOptions.proxy.password = proxyUrl.password;
    }
  }
  return await chromium.launch(launchOptions);
}

async function bypassCloudflare(page, log) {
  // Playwright can handle most Cloudflare JS challenges automatically.
  // For advanced challenges, you may need to add more logic here.
  let tryCount = 0;
  while (true) {
    const title = (await page.title()).toLowerCase();
    if (!title.includes('just a moment')) break;
    if (log) console.log(`Cloudflare detected, waiting... (attempt ${++tryCount})`);
    await page.waitForTimeout(2000);
    if (tryCount > 10) throw new Error('Cloudflare bypass failed after 10 attempts');
  }
  if (log) console.log('Cloudflare bypassed.');
}

// Unified browser/context/page launcher
async function getBrowserContextPage({ proxy, kameleo }) {
  if (kameleo) {
    const { browser, profileId } = await launchBrowserWithKameleo();
    const context = browser.contexts()[0];
    const page = await context.newPage();
    return { browser, context, page, kameleoProfileId: profileId };
  } else {
    const browser = await launchBrowser(proxy);
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
  }
}

app.get('/cookies', async (req, res) => {
  const { url, retries = 5, proxy, kameleo } = req.query;
  if (!url || !isSafeUrl(url)) {
    return res.status(400).json({ detail: 'Invalid URL' });
  }
  let browser, kameleoProfileId;
  try {
    const result = await getBrowserContextPage({ proxy, kameleo: kameleo === 'true' });
    browser = result.browser;
    kameleoProfileId = result.kameleoProfileId;
    const page = result.page;
    const context = result.context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bypassCloudflare(page, LOG);
    const cookiesArr = await context.cookies();
    const cookies = {};
    cookiesArr.forEach(c => { cookies[c.name] = c.value; });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await browser.close();
    if (kameleoProfileId) await closeKameleoProfile(kameleoProfileId);
    res.json({ cookies, user_agent: userAgent });
  } catch (e) {
    if (browser) await browser.close();
    if (kameleoProfileId) await closeKameleoProfile(kameleoProfileId);
    res.status(500).json({ detail: e.message });
  }
});

app.get('/html', async (req, res) => {
  const { url, retries = 5, proxy, kameleo } = req.query;
  if (!url || !isSafeUrl(url)) {
    return res.status(400).json({ detail: 'Invalid URL' });
  }
  let browser, kameleoProfileId;
  try {
    const result = await getBrowserContextPage({ proxy, kameleo: kameleo === 'true' });
    browser = result.browser;
    kameleoProfileId = result.kameleoProfileId;
    const page = result.page;
    const context = result.context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bypassCloudflare(page, LOG);
    const html = await page.content();
    const cookiesArr = await context.cookies();
    const cookies = {};
    cookiesArr.forEach(c => { cookies[c.name] = c.value; });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await browser.close();
    if (kameleoProfileId) await closeKameleoProfile(kameleoProfileId);
    res.set('Content-Type', 'text/html');
    res.set('cookies', JSON.stringify(cookies));
    res.set('user_agent', userAgent);
    res.send(html);
  } catch (e) {
    if (browser) await browser.close();
    if (kameleoProfileId) await closeKameleoProfile(kameleoProfileId);
    res.status(500).json({ detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Playwright server running on port ${PORT}`);
}); 