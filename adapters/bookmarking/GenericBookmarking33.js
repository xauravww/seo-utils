import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import BaseAdapter from '../BaseAdapter.js';

const EXTENSION_PATH = path.join(__dirname, 'recaptcha-solver');

class GenericBookmarking33Adapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://bookmarkdrive.com/login';
        this.submitUrl = null; // Will be discovered after login
    }

    async publish() {
        this.log(`[EVENT] Entering GenericBookmarking33Adapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        try {
            browser = await chromium.launch({
                headless: false,
                args: [
                    `--disable-extensions-except=${EXTENSION_PATH}`,
                    `--load-extension=${EXTENSION_PATH}`,
                    '--lang=en-US',
                    '--window-size=1280,800',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                ],
                defaultViewport: { width: 1280, height: 800 },
            });
            context = await browser.newContext();
            page = await context.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
            this.log('[EVENT] Login page loaded.', 'detail', false);

            // Fill username
            const username = this.website.credentials.username;
            const password = this.website.credentials.password;
            let filled = false;
            if (await page.locator('#user_login').count()) {
                await page.locator('#user_login').fill(username);
                filled = true;
            }
            if (!filled && await page.locator('input[name="username"]').count()) {
                await page.locator('input[name="username"]').fill(username);
                filled = true;
            }
            if (!filled && await page.locator('input[name="user_login"]').count()) {
                await page.locator('input[name="user_login"]').fill(username);
                filled = true;
            }

            // Fill password
            filled = false;
            if (await page.locator('#user_pass').count()) {
                await page.locator('#user_pass').fill(password);
                filled = true;
            }
            if (!filled && await page.locator('input[name="password"]').count()) {
                await page.locator('input[name="password"]').fill(password);
                filled = true;
            }
            if (!filled && await page.locator('input[name="user_pass"]').count()) {
                await page.locator('input[name="user_pass"]').fill(password);
                filled = true;
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
                this.log(`No submit page found on: ${this.website.url}`, 'error', true);
                await browser.close();
                return;
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

            // Fill submission form
            const articleDetails = this.content;
            await page.evaluate(({ website, title, email, phone, address, description }) => {
                if (document.querySelector('#articleUrl')) document.querySelector('#articleUrl').value = website;
                if (document.querySelector('#submitpro_title')) document.querySelector('#submitpro_title').value = title;
                if (document.querySelector('#submitpro_email')) document.querySelector('#submitpro_email').value = email;
                if (document.querySelector('#submitpro_phone')) document.querySelector('#submitpro_phone').value = phone;
                if (document.querySelector('#submitpro_address')) document.querySelector('#submitpro_address').value = address;
                if (document.querySelector('#submitpro_desc')) document.querySelector('#submitpro_desc').value = description;
            }, articleDetails);

            // Category selection
            if (await page.locator('#submitpro_category').count()) {
                const currentValue = await page.locator('#submitpro_category').inputValue();
                if (!currentValue) {
                    const options = await page.locator('#submitpro_category option').evaluateAll(opts => opts.map(o => o.value).filter(v => v));
                    if (options.length > 0) {
                        await page.locator('#submitpro_category').selectOption(options[0]);
                        this.log('Category selected: ' + options[0], 'detail', false);
                    }
                }
            }
            // Location selection
            if (await page.locator('#submitpro_location').count()) {
                const currentValue = await page.locator('#submitpro_location').inputValue();
                if (!currentValue) {
                    const options = await page.locator('#submitpro_location option').evaluateAll(opts => opts.map(o => o.value).filter(v => v));
                    if (options.length > 0) {
                        await page.locator('#submitpro_location').selectOption(options[0]);
                        this.log('Location selected: ' + options[0], 'detail', false);
                    }
                }
            }
            // Tags
            if (await page.locator('input[placeholder="Enter tags"]').count()) {
                const tagInputSelector = 'input[placeholder="Enter tags"]';
                await page.locator(tagInputSelector).fill('');
                let tagCount = 0;
                for (const tag of articleDetails.tags || []) {
                    if (tagCount >= 3) break;
                    await page.locator(tagInputSelector).fill('');
                    await page.locator(tagInputSelector).type(tag);
                    await page.keyboard.press('Enter');
                    tagCount++;
                    this.log('Tag entered: ' + tag, 'detail', false);
                }
            }
            // Agree checkbox
            if (await page.locator('#agree-checkbox').count()) {
                let checked = await page.locator('#agree-checkbox').isChecked();
                if (!checked) {
                    await page.locator('#agree-checkbox').focus();
                    await page.keyboard.press(' ');
                    checked = await page.locator('#agree-checkbox').isChecked();
                }
                if (!checked) {
                    await page.evaluate(() => {
                        const cb = document.querySelector('#agree-checkbox');
                        if (cb) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            cb.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    });
                    checked = await page.locator('#agree-checkbox').isChecked();
                }
                if (!checked) {
                    this.log('Failed to check terms and conditions checkbox! Submission will be skipped.', 'error', true);
                    return;
                }
            }
            // Required field checks
            const requiredChecks = [
                { name: 'Website', selector: '#articleUrl' },
                { name: 'Title', selector: '#submitpro_title' },
                { name: 'Category', selector: '#submitpro_category' },
                { name: 'Tags', selector: 'input[placeholder="Enter tags"]' },
                { name: 'Location', selector: '#submitpro_location' },
                { name: 'Email', selector: '#submitpro_email' },
                { name: 'Description', selector: '#submitpro_desc' },
                { name: 'Terms', selector: '#agree-checkbox' },
            ];
            let allFilled = true;
            for (const check of requiredChecks) {
                if (check.name === 'Category' || check.name === 'Location') {
                    const val = await page.locator(check.selector).inputValue();
                    if (!val) {
                        this.log(`Required field missing: ${check.name}`, 'warning', true);
                        allFilled = false;
                    }
                } else if (check.name === 'Tags') {
                    const tagCount = await page.locator('.bootstrap-tagsinput .badge').count();
                    if (tagCount < 1) {
                        this.log('Required field missing: Tags', 'warning', true);
                        allFilled = false;
                    }
                } else if (check.name === 'Terms') {
                    const checked = await page.locator(check.selector).isChecked();
                    if (!checked) {
                        this.log('Required field missing: Terms and Conditions checkbox', 'warning', true);
                        allFilled = false;
                    }
                } else {
                    const val = await page.locator(check.selector).inputValue();
                    if (!val) {
                        this.log(`Required field missing: ${check.name}`, 'warning', true);
                        allFilled = false;
                    }
                }
            }
            if (!allFilled) {
                this.log('Skipping submission due to missing required fields.', 'warning', true);
                return;
            } else {
                this.log('All required fields are filled. Proceeding to submit.', 'detail', false);
            }
            // Wait for recaptcha to be solved by extension
            const recaptchaSelector = '.g-recaptcha-response';
            let recaptchaSolved = false;
            const maxWait = 120;
            for (let i = 0; i < maxWait; i++) {
                const value = await page.locator(recaptchaSelector).inputValue();
                if (value && value.trim().length > 0) {
                    recaptchaSolved = true;
                    this.log('reCAPTCHA solved by extension. Proceeding to submit.', 'detail', false);
                    break;
                }
                if (i % 5 === 0) this.log('Waiting for reCAPTCHA to be solved by extension...', 'detail', false);
                await page.waitForTimeout(1000);
            }
            if (!recaptchaSolved) {
                this.log('reCAPTCHA was not solved by extension within timeout. Skipping submission.', 'warning', true);
                return;
            }
            // Click submit button
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
                const allSubmitBtns = [
                    ...(await page.locator('input[type="submit"]').all()),
                    ...(await page.locator('button[type="submit"]').all()),
                ];
                for (const btn of allSubmitBtns) {
                    const isVisible = await btn.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
                    });
                    if (isVisible) {
                        submitButton = btn;
                        break;
                    }
                }
            }
            let submitClicked = false;
            for (let i = 0; i < 2 && !submitClicked; i++) {
                if (await submitButton.count()) {
                    await submitButton.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(300);
                    await submitButton.click();
                    this.log('Clicked submit button (attempt ' + (i + 1) + ')', 'detail', false);
                    submitClicked = true;
                    await page.waitForTimeout(500);
                }
            }
            if (!submitClicked) {
                this.log('No submit button found or could not click on: ' + this.submitUrl, 'error', true);
            } else {
                this.log('Article form submitted!', 'success', true);
            }
            await page.waitForTimeout(10000);
        } catch (e) {
            this.log(`Failed on: ${this.website.url} - ${e.message}`, 'error', true);
            throw e;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            }
        }
    }
}

export default GenericBookmarking33Adapter;


