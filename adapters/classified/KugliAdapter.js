import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import classifiedCategories from './classifiedCategories.js';

puppeteer.use(StealthPlugin());

class KugliAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://www.kugli.com";
        this.extensionPath = path.join(process.cwd(), "recaptcha-solver");
    }

    randomDelay(min = 20, max = 50) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getCategoryIdByName(name) {
        for (const [catName, catObj] of Object.entries(classifiedCategories)) {
            if (catName.toLowerCase() === name.toLowerCase()) {
                return catObj.id;
            }
        }
        return null;
    }

    getSubcategoryIdByName(categoryName, subcategoryName) {
        const category = classifiedCategories[categoryName];
        if (!category) return null;
        for (const [subId, subName] of Object.entries(category.subcategories)) {
            if (subName.toLowerCase() === subcategoryName.toLowerCase()) {
                return subId;
            }
        }
        return null;
    }

    async publish() {
        let browser, page;
        
        try {
            this.log('Starting Kugli classified ad publication', 'info', true);
            
            // Extract data using BaseAdapter structure
            let email, password, adTitle, adDescription, categoryName, subcategoryName, formData;
            
            try {
                // Extract credentials from website object
                if (this.website && this.website.credentials) {
                    email = this.website.credentials.email;
                    password = this.website.credentials.password;
                } else if (this.website) {
                    email = this.website.email;
                    password = this.website.password;
                } else {
                    throw new Error('No website credentials found');
                }
                
                if (!email || !password) {
                    throw new Error('Email and password are required for Kugli login');
                }

                // Extract content
                adTitle = this.content.title;
                adDescription = this.content.body || this.content.description || this.content.markdown;

                // Clean description - remove URLs and links as Kugli doesn't allow them
                adDescription = this.cleanDescriptionForKugli(adDescription);

                // Ensure description is at least 200 characters
                if (adDescription.length < 200) {
                    const extensionText = ' This listing provides comprehensive information about the product/service. For more details and inquiries, please contact us through the provided contact information. We offer professional services with competitive pricing and excellent customer support.';
                    adDescription += extensionText;

                    // Trim to reasonable length if too long after extension
                    if (adDescription.length > 1000) {
                        adDescription = adDescription.substring(0, 997) + '...';
                    }
                }
                
                // Extract category information
                categoryName = this.content.category || 'Sell & Buy';
                subcategoryName = this.content.subcategory || 'Equipment & Tools';
                
                // Build form data
                formData = {
                    adTitle: adTitle,
                    countryId: this.content.countryId || "BD",
                    regionId: this.content.regionId || "36", 
                    cityId: this.content.cityId || "179294",
                    typeOfAd: this.content.typeOfAd || "1",
                    price: this.content.price || "100",
                    currency: this.content.currency || "USD",
                    externalLink: this.content.url || this.content.externalLink || "https://example.com",
                    adDescription: adDescription,
                    keywords: this.content.tags || this.content.keywords || "classified, listing",
                    premiumOption: this.content.premiumOption || "no"
                };
                
                this.log(`Extracted data: email=${email}, title=${adTitle ? 'present' : 'missing'}`, 'detail', false);
                this.log(`Category: ${categoryName}, Subcategory: ${subcategoryName}`, 'detail', false);
                this.log(`Description length: ${adDescription.length} chars`, 'detail', false);
                
            } catch (extractError) {
                throw new Error(`Failed to extract data: ${extractError.message}`);
            }

            // Launch browser with stealth plugin
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    `--disable-extensions-except=${this.extensionPath}`,
                    `--load-extension=${this.extensionPath}`,
                    "--lang=en-US",
                    "--window-size=1280,800",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                ],
                defaultViewport: { width: 1280, height: 800 },
            });

            page = (await browser.pages())[0] || (await browser.newPage());
            await page.setViewport({ width: 1280, height: 800 });
            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            );
            await page.setExtraHTTPHeaders({
                "Accept-Language": "en-US,en;q=0.9",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            });

            // Clear cookies for clean session
            const client = await page.target().createCDPSession();
            await client.send("Network.clearBrowserCookies");

            // Step 1: Navigate to Kugli and login
            this.log('Navigating to Kugli homepage', 'detail', false);
            await page.goto(this.baseUrl, { waitUntil: "networkidle2" });
            await this.wait(1000);

            // Fill login form
            this.log('Filling login credentials', 'detail', false);
            await page.type('input[name="email"]', email, { delay: this.randomDelay(20, 60) });
            await page.type('input[name="password"]', password, { delay: this.randomDelay(20, 60) });

            // Submit login form
            await page.click('input[type="submit"][value="Login Now"]');
            await page.waitForNavigation({ waitUntil: "networkidle2" });
            this.log('Login completed', 'info', true);

            // Step 2: Navigate directly to classified ad posting form (bypassing category selection)
            const targetUrl = `${this.baseUrl}/business/def/post-edit-classified-ad/catid/1/subcatid/10/`;

            this.log('Navigating directly to classified ad posting form', 'detail', false);
            await page.goto(targetUrl, { waitUntil: "networkidle2" });

            // Step 3: Fill the classified ad form
            this.log('Filling classified ad form', 'detail', false);
            await page.waitForSelector("form#stdform", { timeout: 10000 });

            // Fill form fields (category/subcategory already set by URL)
            await page.type('input[name="adtitle"]', formData.adTitle);

            await page.select('select[name="countryid"]', formData.countryId);

            await page.select('select[name="regionid"]', formData.regionId);

            await page.select('select[name="cityid"]', formData.cityId);

            await page.click(`input[name="type"][value="${formData.typeOfAd}"]`);

            await page.type('input[name="price"]', formData.price);

            await page.select('select[name="shortcurrency"]', formData.currency);

            await page.type('input[name="external_link"]', formData.externalLink);

            await page.type('textarea[name="addescription"]', formData.adDescription);

            await page.type('input[name="keywords"]', formData.keywords);

            await page.select('select[name="kuglipremium"]', formData.premiumOption);

            this.log('Form filled successfully', 'detail', false);

            // Step 4: Submit the form
            this.log('Submitting classified ad', 'detail', false);
            await page.click('input[type="submit"][value="Save Ad"]');
            await page.waitForNavigation({ waitUntil: "networkidle2" });
            this.log('Classified ad submitted successfully', 'info', true);

            // Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-kugli-screenshot.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });

                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                screenshotUrl = cloudinaryResult.secure_url;
                this.logScreenshotUploaded(screenshotUrl);
            } catch (screenshotError) {
                this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
            }

            // Get final URL
            const finalUrl = page.url();
            this.logPublicationSuccess(finalUrl);

            return {
                success: true,
                postUrl: finalUrl,
                screenshotUrl: screenshotUrl
            };

        } catch (error) {
            this.log(`Kugli publication failed: ${error.message}`, 'error', true);
            
            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-kugli-error.png`;
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
                    // await browser.close();
                } catch (closeError) {
                    this.log(`Warning: Could not close browser: ${closeError.message}`, 'warning', true);
                }
            }
        }
    }

    cleanDescriptionForKugli(description) {
        if (!description) return '';

        // Remove URLs (http, https, www, and basic domain patterns)
        let cleaned = description
            .replace(/https?:\/\/[^\s]+/gi, '') // Remove http/https URLs
            .replace(/www\.[^\s]+/gi, '') // Remove www URLs
            .replace(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*/gi, '') // Remove domain patterns
            .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi, '') // Remove email addresses
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();

        return cleaned;
    }
}

export default KugliAdapter;
