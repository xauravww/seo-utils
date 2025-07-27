// import { chromium } from 'patchright';
// import cloudinary from 'cloudinary';
// import fs from 'fs';
// import path from 'path';
// import BaseAdapter from '../BaseAdapter.js';

// import { fileURLToPath } from 'url';
// import { dirname, join } from 'path';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);


// const EXTENSION_PATH = join(__dirname, '../../recaptcha-solver');
// console.log("EXTENSION PATH: ",EXTENSION_PATH)

// class GenericBookmarking33Adapter extends BaseAdapter {
//     constructor(args) {
//         super(args);
//         this.loginUrl = 'https://bookmarkdrive.com/login';
//         this.submitUrl = null; // Will be discovered after login
//     }

//     async publish() {
//         this.log(`[EVENT] Entering GenericBookmarking33Adapter publish method.`, 'info', true);
//         let browser;
//         let context;
//         let page;
//         try {
//             console.log("Launching Chromium with extension path:", EXTENSION_PATH);
//             const userDataDir = './tmp-user-data-dir';
//             browser = await chromium.launchPersistentContext(userDataDir, {
//                 headless: false,
//                 args: [
//                     `--disable-extensions-except=${EXTENSION_PATH}`,
//                     `--load-extension=${EXTENSION_PATH}`,
//                     '--disable-ads',
//                     '--disable-features=AdsFeature',
//                     '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
//                 ],
//                 defaultViewport: { width: 1280, height: 800 },
//             });
//             console.log("Chromium launched with persistent context and extension.");
//             const pages = browser.pages();
//             if (pages.length > 0) {
//                 page = pages[0];
//             } else {
//                 page = await browser.newPage();
//             }
//             this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
//             await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
//             this.log('[EVENT] Login page loaded.', 'detail', false);

//             // Fill username
//             const username = this.website.credentials.username;
//             const password = this.website.credentials.password;
//             let filled = false;
//             if (await page.locator('#user_login').count()) {
//                 await page.locator('#user_login').fill(username);
//                 filled = true;
//             }
//             if (!filled && await page.locator('input[name="username"]').count()) {
//                 await page.locator('input[name="username"]').fill(username);
//                 filled = true;
//             }
//             if (!filled && await page.locator('input[name="user_login"]').count()) {
//                 await page.locator('input[name="user_login"]').fill(username);
//                 filled = true;
//             }

//             // Fill password
//             filled = false;
//             if (await page.locator('#user_pass').count()) {
//                 await page.locator('#user_pass').fill(password);
//                 filled = true;
//             }
//             if (!filled && await page.locator('input[name="password"]').count()) {
//                 await page.locator('input[name="password"]').fill(password);
//                 filled = true;
//             }
//             if (!filled && await page.locator('input[name="user_pass"]').count()) {
//                 await page.locator('input[name="user_pass"]').fill(password);
//                 filled = true;
//             }

//             // Find submit page URL before clicking login
//             this.submitUrl = await page.evaluate(() => {
//                 const anchors = Array.from(document.querySelectorAll('a[href^="/submit-"]'));
//                 if (anchors.length > 0) return anchors[0].href;
//                 const forms = Array.from(document.querySelectorAll('form[action^="/submit-"]'));
//                 if (forms.length > 0) return window.location.origin + forms[0].getAttribute('action');
//                 return null;
//             });
//             if (!this.submitUrl) {
//                 this.submitUrl = await page.evaluate(() => {
//                     const anchors = Array.from(document.querySelectorAll('a[href*="submit-"]'));
//                     if (anchors.length > 0) return anchors[0].href;
//                     const forms = Array.from(document.querySelectorAll('form[action*="submit-"]'));
//                     if (forms.length > 0) return window.location.origin + forms[0].getAttribute('action');
//                     return null;
//                 });
//             }
//             if (!this.submitUrl) {
//                 this.log(`No submit page found on: ${this.website.url}`, 'error', true);
//                 await browser.close();
//                 return;
//             }
//             this.log(`Found submit page before login button click: ${this.submitUrl}`, 'detail', false);

//             // Click login button
//             let submitBtn = await page.locator('input[type="submit"],button[type="submit"]').first();
//             if (await submitBtn.count()) {
//                 await Promise.all([
//                     page.waitForNavigation({ waitUntil: 'networkidle' }),
//                     submitBtn.click()
//                 ]);
//                 this.log(`Submitted login on: ${this.loginUrl}`, 'detail', false);
//             } else {
//                 this.log(`No submit button found on: ${this.loginUrl}`, 'error', true);
//             }

//             // Go to the submit page after login
//             await page.goto(this.submitUrl, { waitUntil: 'networkidle', timeout: 30000 });

//             // Fill submission form
//             const articleDetails = this.content;
//             await page.evaluate(({ url, title, email, phone, address, description }) => {
//                 if (document.querySelector('#articleUrl') && url !== undefined) document.querySelector('#articleUrl').value = url;
//                 if (document.querySelector('#submitpro_title') && title !== undefined) document.querySelector('#submitpro_title').value = title;
//                 if (document.querySelector('#submitpro_email') && email !== undefined) document.querySelector('#submitpro_email').value = email;
//                 if (document.querySelector('#submitpro_phone') && phone !== undefined) document.querySelector('#submitpro_phone').value = phone;
//                 if (document.querySelector('#submitpro_address') && address !== undefined) document.querySelector('#submitpro_address').value = address;
//                 if (document.querySelector('#submitpro_desc') && description !== undefined) document.querySelector('#submitpro_desc').value = description;
//             }, articleDetails);

//             // Category selection - try multiple categories in sequence without validation
//             if (await page.locator('#submitpro_category').count()) {
//                 const categoriesToTry = [
//                     'Business & Services',
//                     'Software & IT Solutions',
//                     'Education & Training',
//                     'Health & Yoga',
//                     'Real Estate & Construction'
//                 ];
//                 let categorySelected = false;
//                 for (const category of categoriesToTry) {
//                     try {
//                         this.log(`Attempting to select category: ${category}`, 'detail', false);
//                         await page.locator('#submitpro_category').selectOption(category);
//                         this.log(`Category selected: ${category}`, 'success', false);
//                         categorySelected = true;
//                         break; // stop after first successful selection
//                     } catch (e) {
//                         this.log(`Failed to select category: ${category} - ${e.message}`, 'warning', true);
//                     }
//                 }
//                 if (!categorySelected) {
//                     this.log('Failed to select any category from the list.', 'error', true);
//                 }
//             }
//             // Location selection
//             // Skipping location selection as it is optional
//             // Tags
//             // Skipping tag filling as per user instruction
//             if (await page.locator('input[placeholder="Enter tags"]:visible').count()) {
//                 this.log('Skipping tag filling as per user instruction.', 'detail', false);
//             }
//             // Agree checkbox
//             if (await page.locator('#agree-checkbox').count()) {
//                 let checked = await page.locator('#agree-checkbox').isChecked();
//                 if (!checked) {
//                     // Try clicking the recaptcha checkbox border if present
//                     if (await page.locator('div.recaptcha-checkbox-border').count()) {
//                         await page.locator('div.recaptcha-checkbox-border').click();
//                         await page.waitForTimeout(500);
//                         checked = await page.locator('#agree-checkbox').isChecked();
//                     }
//                     if (!checked) {
//                         await page.locator('#agree-checkbox').focus();
//                         await page.keyboard.press(' ');
//                         checked = await page.locator('#agree-checkbox').isChecked();
//                     }
//                     if (!checked) {
//                         await page.evaluate(() => {
//                             const cb = document.querySelector('#agree-checkbox');
//                             if (cb) {
//                                 cb.checked = true;
//                                 cb.dispatchEvent(new Event('change', { bubbles: true }));
//                                 cb.dispatchEvent(new Event('input', { bubbles: true }));
//                             }
//                         });
//                         checked = await page.locator('#agree-checkbox').isChecked();
//                     }
//                 }
//                 if (!checked) {
//                     this.log('Failed to check terms and conditions checkbox! Submission will be skipped.', 'error', true);
//                     return;
//                 }
//             }
//             // Required field checks - only Website, Title, Category, Description, and Terms are mandatory
//             const requiredChecks = [
//                 { name: 'Website', selector: '#articleUrl' },
//                 { name: 'Title', selector: '#submitpro_title' },
//                 { name: 'Category', selector: '#submitpro_category' },
//                 { name: 'Description', selector: '#submitpro_desc' },
//                 { name: 'Terms', selector: '#agree-checkbox' },
//             ];
//             let allFilled = true;
//             for (const check of requiredChecks) {
//                 if (check.name === 'Terms') {
//                     const checked = await page.locator(check.selector).isChecked();
//                     if (!checked) {
//                         this.log('Required field missing: Terms and Conditions checkbox', 'warning', true);
//                         allFilled = false;
//                     }
//                 } else {
//                     const val = await page.locator(check.selector).inputValue();
//                     if (!val) {
//                         this.log(`Required field missing: ${check.name}`, 'warning', true);
//                         allFilled = false;
//                     }
//                 }
//             }
//             if (!allFilled) {
//                 this.log('Skipping submission due to missing required fields.', 'warning', true);
//                 return;
//             } else {
//                 this.log('All required fields are filled. Proceeding to submit.', 'detail', false);
//             }
//             // Removed waiting for recaptcha to be solved by extension as per user instruction
//             // Click submit button
//             let submitButton = await page.locator('input[type="submit"][value*="Preview"]').first();
//             if (!await submitButton.count()) submitButton = await page.locator('input[type="submit"][value*="Submit"]').first();
//             if (!await submitButton.count()) submitButton = await page.locator('input[type="submit"][value*="Preview & Submit"]').first();
//             if (!await submitButton.count()) {
//                 const buttons = await page.locator('input[type="submit"]').all();
//                 for (const btn of buttons) {
//                     const val = await btn.inputValue();
//                     if (val && val.toLowerCase().replace(/&amp;/g, '&').includes('submit')) {
//                         submitButton = btn;
//                         break;
//                     }
//                 }
//             }
//             if (!await submitButton.count()) {
//                 const btns = await page.locator('button[type="submit"]').all();
//                 for (const btn of btns) {
//                     const text = await btn.innerText();
//                     if (text && text.toLowerCase().includes('submit')) {
//                         submitButton = btn;
//                         break;
//                     }
//                 }
//             }
//             if (!await submitButton.count()) {
//                 const allSubmitBtns = [
//                     ...(await page.locator('input[type="submit"]').all()),
//                     ...(await page.locator('button[type="submit"]').all()),
//                 ];
//                 for (const btn of allSubmitBtns) {
//                     const isVisible = await btn.evaluate(el => {
//                         const style = window.getComputedStyle(el);
//                         return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
//                     });
//                     if (isVisible) {
//                         submitButton = btn;
//                         break;
//                     }
//                 }
//             }
//             let submitClicked = false;
//             for (let i = 0; i < 2 && !submitClicked; i++) {
//                 if (await submitButton.count()) {
//                     await submitButton.scrollIntoViewIfNeeded();
//                     await page.waitForTimeout(300);
//                     await submitButton.click();
//                     this.log('Clicked submit button (attempt ' + (i + 1) + ')', 'detail', false);
//                     submitClicked = true;
//                     await page.waitForTimeout(500);
//                 }
//             }
//             if (!submitClicked) {
//                 this.log('No submit button found or could not click on: ' + this.submitUrl, 'error', true);
//             } else {
//                 this.log('Article form submitted!', 'success', true);
//                 // Wait for navigation to URL containing '/preview-bookmark' as sign of success
//                 try {
//                     await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
//                     const currentUrl = page.url();
//                     if (currentUrl.includes('/preview-bookmark')) {
//                         this.log(`Submission success confirmed by URL: ${currentUrl}`, 'success', true);
//                     } else {
//                         this.log(`Submission may have failed, unexpected URL: ${currentUrl}`, 'warning', true);
//                     }
//                 } catch (navErr) {
//                     this.log('Navigation after submission timed out or failed.', 'warning', true);
//                 }
//                 // Take screenshot and upload to Cloudinary
//                 try {
//                     const screenshotPath = `screenshot_completion_${this.requestId}.png`;
//                     this.log(`Saving screenshot to: ${screenshotPath}`, 'detail', false);
//                     await page.screenshot({ path: screenshotPath, fullPage: true });
//                     if (fs.existsSync(screenshotPath)) {
//                         this.log(`Screenshot saved successfully. Uploading to Cloudinary...`, 'detail', false);
//                         const uploadResult = await cloudinary.uploader.upload(screenshotPath);
//                         if (uploadResult && uploadResult.secure_url) {
//                             this.log(`Screenshot uploaded to Cloudinary: ${uploadResult.secure_url}`, 'detail', false);
//                         } else {
//                             this.log('Failed to upload screenshot to Cloudinary.', 'warning', true);
//                         }
//                         try {
//                             await fs.promises.unlink(screenshotPath);
//                             this.log(`Local screenshot file deleted: ${screenshotPath}`, 'detail', false);
//                         } catch (unlinkErr) {
//                             this.log(`Failed to delete local screenshot file: ${unlinkErr.message}`, 'warning', true);
//                         }
//                     } else {
//                         this.log(`Screenshot file does not exist: ${screenshotPath}`, 'warning', true);
//                     }
//                 } catch (screenshotErr) {
//                     this.log(`Error taking/uploading screenshot: ${screenshotErr.message}`, 'error', true);
//                 }
//             }
//             await page.waitForTimeout(10000);
//         } catch (e) {
//             this.log(`Failed on: ${this.website.url} - ${e.message}`, 'error', true);
//             throw e;
//             } finally {
//             if (browser) {
//                 try {
//                     await browser.close();
//                     this.log('[EVENT] Browser closed after execution.', 'detail', false);
//                 } catch (closeErr) {
//                     this.log(`Error closing browser: ${closeErr.message}`, 'warning', true);
//                 }
//             }
//         }
//     }
// }

// export default GenericBookmarking33Adapter;


import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import BaseAdapter from '../BaseAdapter.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const EXTENSION_PATH = join(__dirname, '../../recaptcha-solver');
console.log("EXTENSION PATH: ",EXTENSION_PATH)

class GenericBookmarking33Adapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://bookmarkdrive.com/login';
        this.submitUrl = null; // Will be discovered after login
    }

    async publish() {
        this.log(`[EVENT] Entering GenericBookmarking33Adapter publish method.`, 'info', true);
        let browser;
        let page;
        const userDataDir = './tmp-user-data-dir'; // Define user data directory path

        try {
            this.log("Launching Chromium with persistent context and extension path:", 'detail', false);
            
            // Randomize user agent to avoid fingerprinting
            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            ];
            const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

            // Use launchPersistentContext to ensure extension works correctly
            browser = await chromium.launchPersistentContext(userDataDir, {
                headless: false,
                args: [
                    `--disable-extensions-except=${EXTENSION_PATH}`,
                    `--load-extension=${EXTENSION_PATH}`,
                    '--disable-ads',
                    '--disable-features=AdsFeature',
                    '--disable-blink-features=AutomationControlled', // Key anti-detection flag
                    `--user-agent=${userAgent}`,
                ],
                defaultViewport: { width: 1280, height: 800 },
            });

            this.log("Chromium launched. Getting the page...", 'detail', false);
            const pages = await browser.pages();
            if (pages.length > 0) {
                page = pages[0];
            } else {
                page = await browser.newPage();
            }

            // Add an init script to apply stealth settings before the page loads
            await page.addInitScript(() => {
                // Pass the Webdriver test
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                });
                // Pass the Permissions test
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
                // Pass the Plugins Length test
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3], // Mock a realistic number of plugins
                });
                // Pass the Languages test
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                });
            });
            
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
            this.log('[EVENT] Login page loaded.', 'detail', false);

            // --- Direct form filling ---
            const username = this.website.credentials.username;
            const password = this.website.credentials.password;

            // Fill username
            if (await page.locator('#user_login').count()) {
                await page.locator('#user_login').fill(username);
            } else if (await page.locator('input[name="username"]').count()) {
                await page.locator('input[name="username"]').fill(username);
            } else if (await page.locator('input[name="user_login"]').count()) {
                await page.locator('input[name="user_login"]').fill(username);
            }

            // Fill password
            if (await page.locator('#user_pass').count()) {
                await page.locator('#user_pass').fill(password);
            } else if (await page.locator('input[name="password"]').count()) {
                await page.locator('input[name="password"]').fill(password);
            } else if (await page.locator('input[name="user_pass"]').count()) {
                await page.locator('input[name="user_pass"]').fill(password);
            }
            
            // Find submit page URL before clicking login
            this.submitUrl = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href^="/submit-"]'));
                if (anchors.length > 0) return anchors[0].href;
                const forms = Array.from(document.querySelectorAll('form[action^="/submit-"]'));
                if (forms.length > 0) return window.location.origin + forms[0].getAttribute('action');
                return null;
            });
            if (!this.submitUrl) {
                this.submitUrl = await page.evaluate(() => {
                    const anchors = Array.from(document.querySelectorAll('a[href*="submit-"]'));
                    if (anchors.length > 0) return anchors[0].href;
                    const forms = Array.from(document.querySelectorAll('form[action*="submit-"]'));
                    if (forms.length > 0) return window.location.origin + forms[0].getAttribute('action');
                    return null;
                });
            }
            if (!this.submitUrl) {
                const messageText = `No submit page found on: ${this.website.url}`;
                this.log(messageText, 'error', true);
                return { success: false, message: messageText, reviewUrl: null, reviewScreenshot: null };
            }
            this.log(`Found submit page before login button click: ${this.submitUrl}`, 'detail', false);

            // Click login button
            let submitBtn = await page.locator('input[type="submit"],button[type="submit"]').first();
            if (await submitBtn.count()) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle' }),
                    submitBtn.click()
                ]);
                this.log(`Submitted login on: ${this.loginUrl}`, 'detail', false);
            } else {
                this.log(`No submit button found on: ${this.loginUrl}`, 'error', true);
            }

            // Go to the submit page after login
            await page.goto(this.submitUrl, { waitUntil: 'networkidle', timeout: 30000 });

            // Set up network listener for CAPTCHA success signal
            let captchaSolved = false;
            this.log('Setting up network listener for CAPTCHA verification...', 'detail', false);
            page.on('response', async (response) => {
                // The URL for user verification is typically '.../recaptcha/api2/userverify'
                if (response.url().includes('recaptcha/api2/userverify') && response.ok() && !captchaSolved) {
                    this.log('CAPTCHA verification network response detected.', 'success', false);
                    captchaSolved = true;
                }
            });

            // Fill submission form directly, checking if data exists
            const articleDetails = this.content;
            if (articleDetails.url) await page.locator('#articleUrl').fill(articleDetails.url);
            if (articleDetails.title) await page.locator('#submitpro_title').fill(articleDetails.title);
            if (articleDetails.email) await page.locator('#submitpro_email').fill(articleDetails.email);
            if (articleDetails.phone) await page.locator('#submitpro_phone').fill(articleDetails.phone);
            if (articleDetails.address) await page.locator('#submitpro_address').fill(articleDetails.address);
            if (articleDetails.description) await page.locator('#submitpro_desc').fill(articleDetails.description);

            // Category selection
            if (await page.locator('#submitpro_category').count()) {
                const categoriesToTry = [ 'Business & Services', 'Software & IT Solutions', 'Education & Training', 'Health & Yoga', 'Real Estate & Construction' ];
                let categorySelected = false;
                for (const category of categoriesToTry) {
                    try {
                        await page.locator('#submitpro_category').selectOption(category);
                        this.log(`Category selected: ${category}`, 'success', false);
                        categorySelected = true;
                        break;
                    } catch (e) { /* Ignore error and try next */ }
                }
                if (!categorySelected) this.log('Failed to select any category from the list.', 'error', true);
            }

            // Step 1: Wait for the CAPTCHA to be solved, signaled by the network response.
            this.log('Waiting for CAPTCHA to be solved by the extension...', 'detail', false);
            let waitAttempts = 0;
            const maxWaitAttempts = 60; // Wait for up to 60 seconds
            while (!captchaSolved && waitAttempts < maxWaitAttempts) {
                await page.waitForTimeout(1000);
                waitAttempts++;
            }

            if (!captchaSolved) {
                const messageText = 'Timed out waiting for CAPTCHA solution network signal. Submission will be skipped.';
                this.log(messageText, 'error', true);
                return { success: false, message: messageText, reviewUrl: page.url(), reviewScreenshot: null };
            }
            this.log('CAPTCHA solution detected. Proceeding.', 'success', false);
            this.log('Waiting for a few seconds to ensure CAPTCHA does not reset...', 'detail', false);
            await page.waitForTimeout(3000); // Add a 3-second delay for stability

            // Step 2: Now, handle the "Agree" checkbox after CAPTCHA is stable.
            const agreeCheckbox = page.locator('#agree-checkbox');
            if (await agreeCheckbox.count() && !await agreeCheckbox.isChecked()) {
                this.log('Attempting to check the "Agree" checkbox...', 'detail', false);
                try {
                    const label = page.locator('label[for="agree-checkbox"]');
                    if (await label.count()) {
                        await label.click();
                    } else {
                        await agreeCheckbox.click({ force: false, timeout: 5000 });
                    }
                    await page.waitForTimeout(500);
                    if (!await agreeCheckbox.isChecked()) {
                        await agreeCheckbox.evaluate(node => {
                            node.checked = true;
                            node.dispatchEvent(new Event('change', { bubbles: true }));
                            node.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                    }
                } catch (e) {
                    this.log(`An error occurred while trying to check the box: ${e.message}`, 'warning', true);
                }
                if (!await agreeCheckbox.isChecked()) {
                     const messageText = 'Failed to check terms and conditions checkbox after multiple attempts! Submission will be skipped.';
                     this.log(messageText, 'error', true);
                     return { success: false, message: messageText, reviewUrl: page.url(), reviewScreenshot: null };
                } else {
                    this.log('Successfully checked the "Agree" checkbox.', 'success', false);
                }
            }
            
            // Step 3: Perform final required field checks just before submission.
            const requiredChecks = [
                { name: 'Website', selector: '#articleUrl' },
                { name: 'Title', selector: '#submitpro_title' },
                { name: 'Category', selector: '#submitpro_category' },
                { name: 'Description', selector: '#submitpro_desc' },
                { name: 'Terms', selector: '#agree-checkbox' },
            ];
            let allFilled = true;
            for (const check of requiredChecks) {
                const isFilled = check.name === 'Terms' ? await page.locator(check.selector).isChecked() : await page.locator(check.selector).inputValue();
                if (!isFilled) {
                    this.log(`Required field missing: ${check.name}`, 'warning', true);
                    allFilled = false;
                }
            }
            if (!allFilled) {
                const messageText = 'Skipping submission due to missing required fields.';
                this.log(messageText, 'warning', true);
                return { success: false, message: messageText, reviewUrl: page.url(), reviewScreenshot: null };
            } else {
                this.log('All required fields are filled. Proceeding to submit.', 'detail', false);
            }

            // Step 4: Find and click the submit button.
            this.log('Finding the submit button...', 'detail', false);
            let submitButton = await page.locator('input[type="submit"][value*="Preview"]').first();
            if (!await submitButton.count()) submitButton = await page.locator('input[type="submit"][value*="Submit"]').first();
            if (!await submitButton.count()) submitButton = await page.locator('input[type="submit"][value*="Preview & Submit"]').first();
            if (!await submitButton.count()) {
                const buttons = await page.locator('input[type="submit"]').all();
                for (const btn of buttons) {
                    const val = await btn.inputValue();
                    if (val && val.toLowerCase().replace(/&amp;/g, '&').includes('submit')) {
                        submitButton = btn;
                        break;
                    }
                }
            }
            if (!await submitButton.count()) {
                const btns = await page.locator('button[type="submit"]').all();
                for (const btn of btns) {
                    const text = await btn.innerText();
                    if (text && text.toLowerCase().includes('submit')) {
                        submitButton = btn;
                        break;
                    }
                }
            }
            
            if (!await submitButton.count()) {
                const messageText = 'No submit button found after handling CAPTCHA.';
                this.log(messageText, 'error', true);
                return { success: false, message: messageText, reviewUrl: page.url(), reviewScreenshot: null };
            } else {
                await submitButton.scrollIntoViewIfNeeded();
                this.log('Attempting to click the submit button...', 'detail', false);
                
                try {
                    // Wait for any navigation to complete after the click.
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 25000 }),
                        submitButton.click()
                    ]);

                    const messageText = `Navigation successful after submission. Final URL: ${page.url()}`;
                    this.log(messageText, 'success', true);
                    const currentUrlCheck = page.url();
                    let cloudinaryUrl = null;

                    // Take screenshot and upload to Cloudinary
                    const screenshotPath = `screenshot_completion_${this.requestId}.png`;
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    this.log(`Screenshot saved to: ${screenshotPath}`, 'detail', false);
                    if (fs.existsSync(screenshotPath)) {
                        const uploadResult = await cloudinary.uploader.upload(screenshotPath);
                        cloudinaryUrl = uploadResult.secure_url;
                        this.log(`Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`, 'detail', false);
                        await fs.promises.unlink(screenshotPath);
                    }
                    
                    return { success: true, message: messageText, reviewUrl: currentUrlCheck, reviewScreenshot: cloudinaryUrl };

                } catch (navError) {
                    const messageText = `Navigation after submission failed or timed out: ${navError.message}`;
                    this.log(messageText, 'error', true);
                    return { success: false, message: messageText, reviewUrl: page.url(), reviewScreenshot: null };
                }
            }
        } catch (e) {
            const messageText = `Failed on: ${this.website.url} - ${e.message}`;
            this.log(messageText, 'error', true);
            return { success: false, message: messageText, reviewUrl: this.website.url, reviewScreenshot: null };
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    this.log('[EVENT] Browser closed after execution.', 'detail', false);
                } catch (closeErr) {
                    this.log(`Error closing browser: ${closeErr.message}`, 'warning', true);
                }
            }
            // Clean up the persistent user data directory to ensure a fresh start next time
            if (fs.existsSync(userDataDir)) {
                try {
                    this.log(`Clearing persistent user data from: ${userDataDir}`, 'detail', false);
                    await fs.promises.rm(userDataDir, { recursive: true, force: true });
                    this.log('Persistent user data cleared successfully.', 'detail', false);
                } catch (rmErr) {
                    this.log(`Failed to clear persistent user data: ${rmErr.message}`, 'warning', true);
                }
            }
        }
    }
}

export default GenericBookmarking33Adapter;