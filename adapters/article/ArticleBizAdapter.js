import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';

// Category mapping for ArticleBiz
const CATEGORIES = {
    // Arts & Entertainment
    arts_entertainment: 1,
    books_music: 41,
    humor: 42,
    tv_movies: 43,
    
    // Business
    business: 13,
    affiliate_programs: 100,
    marketing_advertising: 99,
    management: 105,
    sales_service: 107,
    
    // Computers & Technology
    computers_technology: 3,
    blogging_forums: 49,
    internet: 59,
    seo: 54,
    technology: 57,
    web_hosting: 58,
    
    // Health & Fitness
    health_fitness: 12,
    beauty: 93,
    exercise_meditation: 95,
    nutrition_supplement: 98,
    weight_loss: 97,
    
    // Finance
    finance: 15,
    trading_investing: 118,
    wealth_building: 119,
    
    // Self-Improvement
    self_improvement: 14,
    advice: 109,
    leadership: 110,
    motivational: 111,
    success: 116
};

class ArticleBizAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://articlebiz.com";
    }

    async publish() {
        let browser, page;
        
        try {
            this.log('Starting ArticleBiz publication', 'info', true);
            
            // Launch browser
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            page = await browser.newPage();

            // Extract data using BaseAdapter structure
            let authorName, email, title, body, category, biography;

            try {
                // Extract content first (this is the primary source)
                if (!this.content) {
                    throw new Error('No content object found');
                }

                // Extract email from content with multiple fallbacks
                email = this.content.email ||
                       (this.content.info && this.content.info.user && this.content.info.user.public_email_address) ||
                       (this.content.info && this.content.info.user_email) ||
                       (this.content.info && this.content.info.user && this.content.info.user.email);

                if (!email) {
                    throw new Error('No email found in content object or info. Available fields: ' + Object.keys(this.content).join(', '));
                }

                // Extract author name from email prefix (e.g., "john.doe@example.com" -> "john.doe")
                const emailPrefix = email.split('@')[0];
                authorName = this.content.authorName ||
                           (this.content.info && this.content.info.user_name) ||
                           this.content.name ||
                           emailPrefix;

                // Extract other content fields
                title = this.content.title;
                body = this.content.body || this.content.markdown || this.content.html;

                // Extract biography/resource box content with priority order
                biography = this.content.biography ||
                           (this.content.info && this.content.info.user && this.content.info.user.about_business_description) ||
                           this.content.description ||
                           `${authorName} is a content creator. Visit ${this.content.url || 'our website'} for more insights.`;

                // Default category or extract from content
                category = this.content.category || 'business';

                this.log(`Extracted data: author=${authorName}, email=${email}, title=${title ? 'present' : 'missing'}`, 'detail', false);

            } catch (extractError) {
                throw new Error(`Failed to extract data: ${extractError.message}`);
            }

            if (!authorName || !email || !title || !body) {
                throw new Error('Author name, email, title, and body are required for ArticleBiz');
            }

            // Navigate to submit page
            this.log('Navigating to ArticleBiz submit page', 'detail', false);
            
            try {
                await page.goto(`${this.baseUrl}/submitArticle`, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
            } catch (navError) {
                throw new Error(`Failed to navigate to submit page: ${navError.message}`);
            }

            // Wait for form
            try {
                await page.waitForSelector('form[action="https://articlebiz.com/submitArticle"]', { timeout: 15000 });
            } catch (formError) {
                throw new Error(`Submit form not found: ${formError.message}`);
            }

            // Fill form fields
            try {
                await page.fill('#authorName', authorName);
                await page.fill('#email', email);
                await page.fill('#title', title);
                this.log('Basic form fields filled', 'detail', false);
            } catch (fillError) {
                throw new Error(`Failed to fill basic form fields: ${fillError.message}`);
            }

            // Select category
            try {
                const categoryId = CATEGORIES[category] || CATEGORIES['business'];
                await page.selectOption('#categoryId', categoryId.toString());
                this.log(`Category selected: ${category} (ID: ${categoryId})`, 'detail', false);
            } catch (categoryError) {
                this.log(`Warning: Could not select category: ${categoryError.message}`, 'warning', true);
            }

            // Fill article body and biography
            try {
                await page.fill('#body', body);
                await page.fill('#biography', biography);
                this.log('Article content filled', 'detail', false);
            } catch (contentError) {
                throw new Error(`Failed to fill article content: ${contentError.message}`);
            }

            // Solve math captcha
            try {
                const captchaLabel = await page.$eval('label[for="mathcaptcha"]', el => el.textContent);
                this.log(`Solving captcha: ${captchaLabel}`, 'detail', false);

                let answer;
                const addMatch = captchaLabel.match(/(\d+)\s*\+\s*(\d+)/);
                const subMatch = captchaLabel.match(/(\d+)\s*-\s*(\d+)/);
                const mulMatch = captchaLabel.match(/(\d+)\s*\*\s*(\d+)/);

                if (addMatch) {
                    answer = parseInt(addMatch[1]) + parseInt(addMatch[2]);
                } else if (subMatch) {
                    answer = parseInt(subMatch[1]) - parseInt(subMatch[2]);
                } else if (mulMatch) {
                    answer = parseInt(mulMatch[1]) * parseInt(mulMatch[2]);
                } else {
                    throw new Error('Could not parse math captcha');
                }

                await page.fill('#mathcaptcha', answer.toString());
                this.log(`Captcha solved: ${answer}`, 'detail', false);
            } catch (captchaError) {
                throw new Error(`Failed to solve captcha: ${captchaError.message}`);
            }

            // Accept terms of service
            try {
                await page.click('label[for="acceptTos"]');
                this.log('Terms of service accepted', 'detail', false);
            } catch (tosError) {
                this.log(`Warning: Could not accept TOS: ${tosError.message}`, 'warning', true);
            }

            // Submit form
            try {
                await page.click('button[type="submit"]');
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                this.log('Form submitted, waiting for review page', 'detail', false);
            } catch (submitError) {
                throw new Error(`Failed to submit form: ${submitError.message}`);
            }

            // Try to submit for review
            try {
                let buttonClicked = false;

                // Try different button selectors
                const buttonSelectors = [
                    'button:has-text("Submit for review")',
                    'button.btn.btn-primary.btn-block[type="submit"]',
                    'button[type="submit"]'
                ];

                for (const selector of buttonSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 5000 });
                        await page.click(selector);
                        await page.waitForLoadState('networkidle', { timeout: 30000 });
                        this.log('Article submitted for review', 'info', true);
                        buttonClicked = true;
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!buttonClicked) {
                    this.log('Could not find review button - article may be in draft state', 'warning', true);
                }
            } catch (reviewError) {
                this.log(`Warning: Could not submit for review: ${reviewError.message}`, 'warning', true);
            }

            // Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-articlebiz-screenshot.png`;
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
            this.log(`ArticleBiz publication failed: ${error.message}`, 'error', true);
            
            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-articlebiz-error.png`;
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

export default ArticleBizAdapter;
