import chalk from 'chalk';
import { chromium } from 'playwright-extra';
import cloudinary from 'cloudinary';
import fs from 'fs';
import * as websocketLogger from '../../websocketLogger.js';

class UBookmarkingAdapter {
  constructor({ requestId, website, content }) {
    this.requestId = requestId;
    this.website = website;
    this.content = content;
    this.loginUrl = 'https://ubookmarking.xyz/login';
  }

  async publish() {
    let browser;
    try {
      browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      // Step 1: Navigate to login page
      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
      this.log(chalk.blue(`[EVENT] Navigated to login page: ${this.loginUrl}`));

      // Step 2: Fill login form and submit
      await page.fill('input#Name[name="username"]', this.website.credentials.username);
      await page.fill('input#password[name="password"]', this.website.credentials.password);
      this.log(chalk.blue('[EVENT] Filled login form'));
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('button[name="submit"].btn-common.log-btn')
      ]);
      this.log(chalk.green('[EVENT] Logged in successfully'));

      // Step 3: Fill URL and click continue
      await page.fill('input#web_url[name="web_url"]', this.content.url);
      this.log(chalk.blue('[EVENT] Filled URL input'));
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('button#btnkrkSubmit[name="submit"].btn-common.log-btn')
      ]);
      this.log(chalk.green('[EVENT] Clicked continue button'));

      // Step 4: Fill title, select category, tags, description
      await page.fill('input#title[name="title"]', this.content.title);
      this.log(chalk.blue('[EVENT] Filled title input'));

      await page.selectOption('select#category[name="category"]', { value: '1' }); // Business & Services
      this.log(chalk.blue('[EVENT] Selected category Business & Services'));

      await page.fill('input#tags[name="tags"]', this.content.tags || '');
      this.log(chalk.blue('[EVENT] Filled tags input'));

      await page.fill('textarea#description[name="description"]', this.content.description || '');
      this.log(chalk.blue('[EVENT] Filled description textarea'));

      // Step 5: Parse captcha and fill
      const captchaLabel = await page.textContent('label:has-text("CAPTCHA")');
      const captchaMatch = captchaLabel.match(/CAPTCHA\s*:\s*(\d+)\s*\+\s*(\d+)/i);
      if (!captchaMatch) {
        throw new Error('Captcha label format unexpected or not found');
      }
      const captchaSum = parseInt(captchaMatch[1], 10) + parseInt(captchaMatch[2], 10);
      await page.fill('input#captcha[name="captcha"]', captchaSum.toString());
      this.log(chalk.blue(`[EVENT] Filled captcha with value: ${captchaSum}`));

      // Step 6: Click submit button
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('button#btnkmarkSubmit[name="submit"].btn-common.log-btn')
      ]);
      this.log(chalk.green('[EVENT] Clicked submit button'));

      // Step 7: Extract final URL
      // Wait for either the final URL link or a timeout
      let finalUrl = null;
      try {
        const finalUrlElement = await page.waitForSelector('a.btn-action.btn-view', { timeout: 15000 });
        finalUrl = await finalUrlElement.getAttribute('href');
      } catch (e) {
        this.log(chalk.yellow(`[WARNING] Final URL link not found within timeout: ${e.message}`));
      }

      // Check for error message indicating duplicate title or site down
      const errorSelector = 'div.alert.alert-danger, div.alert.alert-warning, p.text-center[style*="color:red"]';
      let errorMessage = null;
      try {
        const errorElement = await page.locator(errorSelector).elementHandle();
        if (errorElement) {
          errorMessage = await page.textContent(errorSelector);
          this.log(chalk.red(`[ERROR] Submission error message: ${errorMessage}`));
          console.error(chalk.red(`[${this.requestId}] [UBookmarkingAdapter] Submission error message: ${errorMessage}`));
          
          if (errorMessage.includes('This title already taken')) {
            this.log(chalk.red(`[ERROR] Duplicate title detected. Stopping instance.`));
            if (browser) {
              await browser.close();
              this.log(chalk.yellow('[EVENT] Browser closed due to duplicate title error.'));
            }
            return { success: false, error: 'Duplicate title detected. Please change the title and try again.' };
          }
        }
      } catch (err) {
        // No error message found, continue
      }

      if (errorMessage) {
        if (browser) {
          await browser.close();
          this.log(chalk.yellow('[EVENT] Browser closed after execution due to submission error.'));
        }
        return { success: false, error: errorMessage };
      }

      if (!finalUrl) {
        // Try alternative approach: check if redirected to a different page with URL in address bar
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== this.loginUrl) {
          finalUrl = currentUrl;
          this.log(chalk.blue(`[INFO] Using current page URL as final URL: ${finalUrl}`));
        } else {
          throw new Error('Failed to extract final URL after submission');
        }
      }

      this.log(chalk.green(`[SUCCESS] Extracted final URL: ${finalUrl}`));
      console.log(chalk.green(`[${this.requestId}] [UBookmarkingAdapter] Final URL: ${finalUrl}`));

      // Step 8: Take screenshot and upload
      const screenshotPath = `screenshot_${this.requestId}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.log(chalk.blue('[EVENT] Screenshot taken after submission'));

      const uploadResult = await cloudinary.uploader.upload(screenshotPath);
      this.log(chalk.blue(`[EVENT] Screenshot uploaded to Cloudinary: ${uploadResult.secure_url}`));
      console.log(chalk.blue(`[${this.requestId}] [UBookmarkingAdapter] Screenshot URL: ${uploadResult.secure_url}`));

      fs.unlinkSync(screenshotPath);

      await browser.close();
      this.log(chalk.yellow('[EVENT] Browser closed after execution'));

      return { success: true, finalUrl, screenshotUrl: uploadResult.secure_url };
    } catch (error) {
      this.log(chalk.red(`[ERROR] UBookmarkingAdapter error: ${error.message}`));
      console.error(chalk.red(`[${this.requestId}] [UBookmarkingAdapter] Error: ${error.message}`));

      if (browser) {
        try {
          const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
          await browser.newPage().then(async page => {
            await page.screenshot({ path: errorScreenshotPath, fullPage: true });
          });
          const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
          this.log(chalk.yellow(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`));
          console.log(chalk.yellow(`[${this.requestId}] [UBookmarkingAdapter] Error screenshot URL: ${errorCloudinaryResult.secure_url}`));
          fs.unlinkSync(errorScreenshotPath);
        } catch (e) {
          this.log(chalk.red(`[ERROR] Failed to capture error screenshot: ${e.message}`));
        }
        await browser.close();
      }

      return { success: false, error: error.message };
    }
  }

  log(message, level = 'detail') {
    const formattedMessage = `[UBookmarkingAdapter] ${message}`;
    websocketLogger.log(this.requestId, formattedMessage, level);
  }
}

export { UBookmarkingAdapter };
