import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';

class ArticleAlleyAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://www.articlealley.com";

        // Selectors to avoid clicking (delete buttons, etc.)
        this.avoidSelectors = [
            'button[onclick*="delete"]',
            'a[onclick*="delete"]',
            '.delete-btn',
            '.btn-delete',
            'button:has-text("Delete")',
            'a:has-text("Delete")',
            'button:has-text("Remove")',
            'a:has-text("Remove")',
            '.fa-trash',
            '.fa-delete'
        ];
    }

    /**
     * Safely click an element while avoiding delete buttons
     */
    async safeClick(page, selector, description = '') {
        try {
            // Check if the element exists
            const element = await page.$(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }

            // Get element text and attributes to check if it's a delete button
            const elementText = await element.textContent();
            const elementClass = await element.getAttribute('class') || '';
            const elementOnclick = await element.getAttribute('onclick') || '';

            // Check if this looks like a delete button
            const isDeleteButton = elementText?.toLowerCase().includes('delete') ||
                                  elementText?.toLowerCase().includes('remove') ||
                                  elementClass.includes('delete') ||
                                  elementClass.includes('trash') ||
                                  elementOnclick.includes('delete');

            if (isDeleteButton) {
                this.log(`⚠️ SAFETY: Avoided clicking potential delete button: ${selector} (text: "${elementText}")`, 'warning', true);
                return false;
            }

            // Safe to click
            await page.click(selector);
            this.log(`✅ Safely clicked: ${description || selector}`, 'detail', false);
            return true;
        } catch (error) {
            this.log(`❌ Failed to click ${selector}: ${error.message}`, 'warning', true);
            return false;
        }
    }

    async publish() {
        let browser, page;
        
        try {
            this.log('Starting ArticleAlley publication', 'info', true);
            
            // Launch browser
            browser = await chromium.launch({
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
            });
            page = await browser.newPage();

            // Extract data using BaseAdapter structure
            let email, password, title, content, description, categories, tags;

            try {
                // Extract credentials from website object (like JumpArticles)
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
                    throw new Error('Email and password are required for ArticleAlley login');
                }

                // Extract content
                title = this.content.title;
                content = this.content.body || this.content.html || this.content.markdown;

                // Extract and limit description to 500 characters max
                let rawDescription = this.content.description ||
                                   (content ? content.substring(0, 400) : '');

                // Remove HTML tags and limit to 500 characters
                description = rawDescription.replace(/<[^>]*>/g, '').substring(0, 500);
                if (rawDescription.length > 500) {
                    description = description.substring(0, 497) + '...';
                }

                // Extract categories and tags
                categories = this.content.categories || ['Technology'];
                tags = this.content.tags ? this.content.tags.split(',').map(tag => tag.trim()) :
                       ['web development', 'technology', 'content'];

                this.log(`Extracted data: email=${email}, title=${title ? 'present' : 'missing'}`, 'detail', false);
                this.log(`Description (${description.length} chars): ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`, 'detail', false);
                this.log(`Categories: ${categories.join(', ')}, Tags: ${tags.join(', ')}`, 'detail', false);

            } catch (extractError) {
                throw new Error(`Failed to extract data: ${extractError.message}`);
            }

            if (!email || !password || !title || !content) {
                throw new Error('Email, password, title, and content are required for ArticleAlley');
            }

            // Step 1: Login
            this.log('Logging into ArticleAlley', 'detail', false);
            
            try {
                await page.goto(`${this.baseUrl}/login`, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });

                await page.waitForSelector('.login-form', { timeout: 10000 });
                await page.fill('#email', email);
                await page.fill('#password', password);
                await this.safeClick(page, '#PostUserLogin', 'Login button');
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(3000);
                
                this.log('Login completed', 'info', true);
            } catch (loginError) {
                throw new Error(`Login failed: ${loginError.message}`);
            }

            // Step 2: Navigate to create page
            this.log('Navigating to article creation page', 'detail', false);
            
            try {
                await page.goto(`${this.baseUrl}/create?new=news`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
            } catch (navError) {
                this.log('Direct navigation failed, trying alternative approach', 'detail', false);
                try {
                    await page.goto(`${this.baseUrl}/`, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(2000);
                    await this.safeClick(page, 'a[href="https://www.articlealley.com/create?new=news"]', 'Create article link');
                    await page.waitForLoadState('domcontentloaded');
                } catch (altNavError) {
                    throw new Error(`Navigation to create page failed: ${altNavError.message}`);
                }
            }

            this.log('Create page loaded, filling form', 'detail', false);

            // Step 3: Fill the article form
            try {
                // Fill title
                await page.fill('input[name="headline"]', title);
                this.log('Title filled', 'detail', false);

                // Fill description
                await page.fill('textarea[name="description"]', description);
                this.log('Description filled', 'detail', false);

                // Handle categories
                if (categories.length > 0) {
                    for (const category of categories) {
                        try {
                            await this.safeClick(page, '#tagcats-selectized', `Category input for ${category}`);
                            await page.fill('#tagcats-selectized', category);
                            await page.keyboard.press('Enter');
                            await page.waitForTimeout(500);
                        } catch (catError) {
                            this.log(`Warning: Could not add category ${category}: ${catError.message}`, 'warning', true);
                        }
                    }
                    this.log('Categories added', 'detail', false);
                }

                // Fill content in editor
                if (content) {
                    try {
                        await this.safeClick(page, '.simditor-body', 'Content editor');
                        await page.waitForTimeout(1000);
                        await page.keyboard.press('Control+a');
                        await page.fill('.simditor-body', content);
                        this.log('Content filled', 'detail', false);
                    } catch (contentError) {
                        throw new Error(`Failed to fill content: ${contentError.message}`);
                    }
                }

                // Handle tags
                if (tags.length > 0) {
                    for (const tag of tags) {
                        try {
                            await this.safeClick(page, '#tags-selectized', `Tag input for ${tag}`);
                            await page.fill('#tags-selectized', tag);
                            await page.keyboard.press('Enter');
                            await page.waitForTimeout(500);
                        } catch (tagError) {
                            this.log(`Warning: Could not add tag ${tag}: ${tagError.message}`, 'warning', true);
                        }
                    }
                    this.log('Tags added', 'detail', false);
                }

                // Set pagination to show all entries on one page
                try {
                    await page.selectOption('select[name="pagination"]', '0');
                    this.log('Pagination set', 'detail', false);
                } catch (paginationError) {
                    this.log(`Warning: Could not set pagination: ${paginationError.message}`, 'warning', true);
                }

            } catch (formError) {
                throw new Error(`Failed to fill form: ${formError.message}`);
            }

            // Step 4: Submit the article
            try {
                this.log('Submitting article', 'detail', false);
                await this.safeClick(page, 'input[value="Create"]', 'Submit article button');
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                this.log('Article submitted successfully', 'info', true);
            } catch (submitError) {
                throw new Error(`Failed to submit article: ${submitError.message}`);
            }

            // Take screenshot
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-articlealley-screenshot.png`;
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
            this.log(`ArticleAlley publication failed: ${error.message}`, 'error', true);
            
            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-articlealley-error.png`;
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
}

export default ArticleAlleyAdapter;
