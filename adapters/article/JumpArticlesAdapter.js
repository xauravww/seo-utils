import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';

class JumpArticlesAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://jumparticles.com";
    }

    async publish() {
        let browser, page;

        try {
            this.log('Starting JumpArticles publication', 'info', true);

            // Launch browser
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            page = await browser.newPage();

            // Extract credentials and content using BaseAdapter structure
            let email, password, title, body, keywordUrl;

            try {
                // Extract credentials from website object
                if (this.website && this.website.username) {
                    email = this.website.username;
                    password = this.website.password;
                } else if (this.website && this.website.credentials) {
                    email = this.website.credentials.username || this.website.credentials.email;
                    password = this.website.credentials.password;
                } else {
                    throw new Error('No credentials found in website object');
                }

                // Extract content
                if (this.content) {
                    title = this.content.title;
                    body = this.content.body || this.content.markdown || this.content.html;
                    keywordUrl = this.content.url;
                } else {
                    throw new Error('No content object found');
                }

                this.log(`Extracted credentials: email=${email ? 'present' : 'missing'}, password=${password ? 'present' : 'missing'}`, 'detail', false);
                this.log(`Extracted content: title=${title ? 'present' : 'missing'}, body=${body ? body.substring(0, 50) + '...' : 'missing'}`, 'detail', false);

            } catch (extractError) {
                throw new Error(`Failed to extract data: ${extractError.message}. Website: ${JSON.stringify(this.website)}, Content: ${JSON.stringify(this.content)}`);
            }

            if (!email || !password) {
                throw new Error('Email and password are required for JumpArticles');
            }

            if (!title || !body) {
                throw new Error('Title and body are required for JumpArticles');
            }

            // Step 1: Login
            this.log('Navigating to login page', 'detail', false);

            try {
                await page.goto(`${this.baseUrl}/login.asp`, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
            } catch (navError) {
                throw new Error(`Failed to navigate to login page: ${navError.message}`);
            }

            // Wait for login form
            try {
                await page.waitForSelector('#loginform', { timeout: 15000 });
            } catch (selectorError) {
                throw new Error(`Login form not found: ${selectorError.message}`);
            }

            // Fill login credentials
            try {
                await page.fill('input[name="EmailAddress"]', email);
                await page.fill('input[name="Password"]', password);
                this.log('Login credentials entered', 'detail', false);
            } catch (fillError) {
                throw new Error(`Failed to fill login credentials: ${fillError.message}`);
            }

            // Handle validation code
            try {
                const pageContent = await page.textContent('body');
                let validationCodeMatch = pageContent.match(/Your Validation Code is\s*(\d+)/i);

                if (!validationCodeMatch) {
                    validationCodeMatch = pageContent.match(/validation code is\s*(\d+)/i);
                }
                if (!validationCodeMatch) {
                    validationCodeMatch = pageContent.match(/code is\s*(\d+)/i);
                }
                if (!validationCodeMatch) {
                    validationCodeMatch = pageContent.match(/(\d{8,})/);
                }

                if (validationCodeMatch) {
                    const validationCode = validationCodeMatch[1];
                    this.log(`Validation code found: ${validationCode}`, 'detail', false);
                    await page.fill('input[name="Captcha"]', validationCode);
                } else {
                    this.log('No validation code found, proceeding without it', 'detail', false);
                }
            } catch (captchaError) {
                this.log(`Warning: Could not handle validation code: ${captchaError.message}`, 'warning', true);
            }

            // Submit login
            try {
                await page.click('button[type="submit"]');
                await page.waitForLoadState('networkidle', { timeout: 30000 });
            } catch (submitError) {
                throw new Error(`Failed to submit login form: ${submitError.message}`);
            }

            // Check login success
            const currentUrl = page.url();
            if (currentUrl.includes('login')) {
                // Take screenshot for debugging
                try {
                    const debugScreenshotPath = `${this.requestId}-login-failed-debug.png`;
                    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
                    const debugCloudinaryResult = await cloudinary.uploader.upload(debugScreenshotPath);
                    fs.unlinkSync(debugScreenshotPath);
                    this.log(`Login failed debug screenshot: ${debugCloudinaryResult.secure_url}`, 'error', true);
                } catch (screenshotError) {
                    this.log(`Could not take debug screenshot: ${screenshotError.message}`, 'warning', true);
                }
                throw new Error('Login failed - still on login page');
            }

            this.log('Login successful', 'info', true);

            // Step 2: Navigate to submit page
            this.log('Navigating to article submission page', 'detail', false);

            try {
                await page.goto(`${this.baseUrl}/dashboard/submit.asp`, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
            } catch (navError) {
                throw new Error(`Failed to navigate to submission page: ${navError.message}`);
            }

            // Wait for submit form
            try {
                await page.waitForSelector('form[name="frm"]', { timeout: 15000 });
            } catch (formError) {
                throw new Error(`Submission form not found: ${formError.message}`);
            }

            // Select category (default to Business - category 6)
            try {
                await page.selectOption('select[name="ArticleCategoryID"]', '6');
                this.log('Category selected: Business', 'detail', false);
            } catch (categoryError) {
                this.log(`Warning: Could not select category: ${categoryError.message}`, 'warning', true);
            }

            // Fill article title
            try {
                if (title) {
                    await page.fill('textarea[name="ArticleTitle"]', title);
                    this.log('Article title entered', 'detail', false);
                }
            } catch (titleError) {
                throw new Error(`Failed to fill article title: ${titleError.message}`);
            }

            // Fill article body
            try {
                if (body) {
                    await page.fill('textarea[name="ArticleBody"]', body);
                    this.log('Article body entered', 'detail', false);
                }
            } catch (bodyError) {
                throw new Error(`Failed to fill article body: ${bodyError.message}`);
            }

            // Fill keyword and URL if provided
            try {
                if (keywordUrl) {
                    await page.fill('input[name="ArticleKeyword1"]', title || 'Article');
                    await page.fill('input[name="ArticleKeyword1URL"]', keywordUrl);
                    this.log('Keyword and URL entered', 'detail', false);
                }
            } catch (keywordError) {
                this.log(`Warning: Could not fill keyword/URL: ${keywordError.message}`, 'warning', true);
            }

            // Submit the form
            try {
                await page.click('input[name="Submit"]');
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                this.log('Article form submitted to preview', 'detail', false);
            } catch (submitError) {
                throw new Error(`Failed to submit article form: ${submitError.message}`);
            }

            // Try to submit for editorial review
            try {
                await page.waitForSelector('input[value="Submit for Editorial Review"]', { timeout: 10000 });
                await page.click('input[value="Submit for Editorial Review"]');
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                this.log('Article submitted for editorial review', 'info', true);
            } catch (error) {
                // Try alternative approach
                try {
                    await page.waitForSelector('form[name="form3"] input[type="submit"]', { timeout: 10000 });
                    await page.click('form[name="form3"] input[type="submit"]');
                    await page.waitForLoadState('networkidle', { timeout: 30000 });
                    this.log('Article submitted for editorial review (alternative method)', 'info', true);
                } catch (error2) {
                    this.log('Article submitted to preview stage - manual review may be required', 'warning', true);
                }
            }

            // Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-jumparticles-screenshot.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });

                // Upload screenshot to Cloudinary
                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                screenshotUrl = cloudinaryResult.secure_url;
                this.logScreenshotUploaded(screenshotUrl);
            } catch (screenshotError) {
                this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
            }

            // Get final URL (submission confirmation page)
            const finalUrl = page.url();
            this.logPublicationSuccess(finalUrl);

            return {
                success: true,
                postUrl: finalUrl,
                screenshotUrl: screenshotUrl
            };

        } catch (error) {
            this.log(`JumpArticles publication failed: ${error.message}`, 'error', true);

            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-jumparticles-error.png`;
                    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                    const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                    fs.unlinkSync(errorScreenshotPath);
                    this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                } catch (screenshotError) {
                    this.log(`Could not take error screenshot: ${screenshotError.message}`, 'warning', true);
                }
            }

            return {
                success: false,
                error: error.message,
                postUrl: null,
                screenshotUrl: null
            };
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    this.log(`Warning: Could not close browser: ${closeError.message}`, 'warning', true);
                }
            }
        }
    }
}

export default JumpArticlesAdapter;
