import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import BaseAdapter from '../BaseAdapter.js';

class IndiabookClassifiedAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.submitUrl = 'https://www.indiabook.com/cgi-bin/classifieds/add.cgi';
    }

    async publish() {
        this.log(`[EVENT] Entering IndiabookClassifiedAdapter publish method.`, 'info', true);
        let browser;
        let context;
        let page;
        let screenshotUrl = '';
        let errorMessages = [];
        try {
            browser = await chromium.launch({ headless: false });
            context = await browser.newContext();
            page = await context.newPage();
            page.setDefaultTimeout(30000);
            this.log(`[EVENT] Navigating to submission page: ${this.submitUrl}`, 'detail', false);
            await page.goto(this.submitUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation complete.', 'detail', false);
            let parsedContent = {};
            try {
                parsedContent = JSON.parse(this.content.content);
            } catch {}
            const title = parsedContent.title || this.content.title || 'Untitled';
            const description = parsedContent.markdown || this.content.body || 'News site';
            const user = (this.content.info && this.content.info.user) || {};
            const userName = this.content.info?.user_name || user.first_name || 'Sam';
            const userEmail = user.public_email_address || user.email || 'mutebadshah4u@gmail.com';
            const userWebsite = user.public_website_1 || user.company_website || 'https://newsoin.com';
            const userCountry = user.country ? (user.country === 'IN' ? 'India' : user.country) : 'India';
            const userPhone = user.public_mobile_number || '1234567890';
            const userAddress = user.main_office_address || 'Haryana';
            const userCity = user.city || userCountry;
            const userState = user.state || userCountry;
            const userZip = user.zip || (Math.floor(100000 + Math.random() * 900000).toString());
            await page.locator('input[name="Title"]').fill(title);
            await page.locator('input[name="URL"]').fill(userWebsite);
            const categorySelect = page.locator('select[name="Category"]');
            const options = await categorySelect.locator('option').all();
            let selected = false;
            for (const option of options) {
                const text = await option.textContent();
                const value = await option.getAttribute('value') || text;
                if (text && text.trim() === 'Business_and_Products') {
                    await categorySelect.selectOption({ value: value });
                    selected = true;
                    this.log('[INFO] Selected Business_and_Products category.', 'info', true);
                    break;
                }
            }
            if (!selected) {
                for (const option of options) {
                    const text = await option.textContent();
                    const value = await option.getAttribute('value') || text;
                    if (text && text.trim() !== '---') {
                        await categorySelect.selectOption({ value: value });
                        this.log('[WARNING] Business_and_Products not found, selected first available option.', 'warning', true);
                        break;
                    }
                }
            }
            await page.locator('textarea[name="Description"]').fill(description);
            await page.locator('input[name="Contact Name"]').fill(userName);
            await page.locator('input[name="Contact Email"]').fill(userEmail);
            await page.locator('input[name="Address"]').fill(userAddress);
            await page.locator('input[name="City"]').fill(userCity);
            await page.locator('input[name="State"]').fill(userState);
            await page.locator('input[name="Country"]').fill(userCountry);
            await page.locator('input[name="Telephone"]').fill(userPhone);
            await page.locator('input[name="Fax"]').fill('');
            await page.locator('input[name="Zip"]').fill(userZip);
            await page.locator('input[name="Password"]').fill('12345678');
            const confirmPwd = page.locator('input[name="Password1"]');
            if (await confirmPwd.count() > 0) {
                await confirmPwd.fill('12345678');
                this.log('[EVENT] Confirm password field filled.', 'detail', false);
            }
            this.log('[EVENT] All fields filled. Submitting form...', 'detail', false);
            let submitClicked = false;
            const submitBtn = page.locator('input[type="SUBMIT"][name="process_form"]');
            if (await submitBtn.count() > 0) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
                    submitBtn.click()
                ]);
                submitClicked = true;
                this.log('[EVENT] Form submitted using SUBMIT button.', 'detail', false);
            } else {
                const buttonBtn = page.locator('input[type="button"][name="process_form"]');
                if (await buttonBtn.count() > 0) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
                        buttonBtn.click()
                    ]);
                    submitClicked = true;
                    this.log('[EVENT] Form submitted using BUTTON button.', 'detail', false);
                }
            }
            if (!submitClicked) {
                this.log('[ERROR] No submit button found for classified form.', 'error', true);
            }
            const errorUl = await page.locator('ul').first();
            if (await errorUl.isVisible()) {
                const errorLis = await errorUl.locator('li strong.error').all();
                for (const li of errorLis) {
                    const text = await li.innerText();
                    errorMessages.push(text);
                    this.log(`[ERROR] Classified form error: ${text}`, 'error', true);
                }
            }
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after submission.', 'info', true);
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            screenshotUrl = cloudinaryUploadResult.secure_url;
            this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${screenshotUrl}`, 'info', true);
            fs.unlinkSync(screenshotPath);
            return {
                success: true,
                message: 'classified posted but waiting for their approval',
                screenshotUrl,
                errors: errorMessages
            };
        } catch (error) {
            this.log(`[ERROR] IndiabookClassifiedAdapter error: ${error.message}`, 'error', true);
            if (page) {
                const errorScreenshotPath = `${this.requestId}-error-screenshot.png`;
                await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                fs.unlinkSync(errorScreenshotPath);
                this.log(`[EVENT] Error screenshot uploaded to Cloudinary: ${errorCloudinaryResult.secure_url}`, 'info', true);
            }
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export default IndiabookClassifiedAdapter; 