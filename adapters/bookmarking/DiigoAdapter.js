import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import BaseAdapter from '../BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DiigoAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://www.diigo.com/sign-in?referInfo=https%3A%2F%2Fwww.diigo.com';
        this.baseUrl = 'https://www.diigo.com';
        this.extensionPath = path.join(__dirname, '../../recaptcha-solver');
    }

    /**
     * Clean description text for better SEO by removing URLs and brackets
     * @param {string} text - Raw description text
     * @returns {string} - Cleaned description text
     */
    cleanDescriptionForSEO(text) {
        if (!text || typeof text !== 'string') {
            return 'Bookmarked content';
        }

        // Remove URLs (http, https, www)
        let cleaned = text.replace(/https?:\/\/[^\s]+/gi, '');
        cleaned = cleaned.replace(/www\.[^\s]+/gi, '');
        
        // Remove markdown-style links [text](url)
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/gi, '$1');
        
        // Remove square brackets [ ] but keep the content inside
        cleaned = cleaned.replace(/\[([^\]]+)\]/gi, '$1');
        
        // Remove angle brackets < > but keep the content inside
        cleaned = cleaned.replace(/<([^>]+)>/gi, '$1');
        
        // Clean up extra spaces and newlines
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        
        // Remove any remaining special characters that might affect SEO
        cleaned = cleaned.replace(/[^\w\s.,!?;:()\-'"&]/gi, ' ');
        
        // Clean up multiple spaces again
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        
        return cleaned || 'Bookmarked content';
    }

    async publish() {
        this.log(`[EVENT] Entering DiigoAdapter publish method.`, 'info', true);
        let browser;
        let page;
        
        try {
            this.log('[DEBUG] Launching Chromium with CAPTCHA solver extension...', 'detail', false);
            this.log(`[DEBUG] Extension path: ${this.extensionPath}`, 'detail', false);

            const userDataDir = './tmp-user-data-dir-diigo';

            // Use launchPersistentContext to ensure extension works correctly
            browser = await chromium.launchPersistentContext(userDataDir, {
                headless: false,
                args: [
                    `--disable-extensions-except=${this.extensionPath}`,
                    `--load-extension=${this.extensionPath}`,
                    '--disable-ads',
                    '--disable-features=AdsFeature',
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ],
                defaultViewport: { width: 1280, height: 800 },
            });

            this.log('[DEBUG] Chromium launched with extension.', 'detail', false);
            this.log('[EVENT] Browser launched successfully.', 'info', false);

            // Get the page from persistent context
            const pages = browser.pages();
            if (pages.length > 0) {
                page = pages[0];
            } else {
                page = await browser.newPage();
            }
            page.setDefaultTimeout(60000);

            // Step 1: Navigate to login page and login
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);

            // Fill login form
            this.log('[EVENT] Filling login form...', 'detail', false);

            // Extract credentials with proper error handling
            const username = this.website.credentials?.username || this.website.credentials?.email || this.website.username || this.website.email;
            const password = this.website.credentials?.password || this.website.password;

            if (!username || !password) {
                throw new Error('Username/email and password are required for Diigo login');
            }

            this.log(`[DEBUG] Using username: ${username}`, 'detail', false);

            await page.locator('input[name="Username"]').fill(username);
            await page.locator('input[name="password"]').fill(password);
            
            this.log('[EVENT] Login form filled. Waiting for CAPTCHA completion...', 'detail', false);
            
            // Handle CAPTCHA completion with retry logic
            let loginSuccessful = false;
            let loginAttempts = 0;
            const maxLoginAttempts = 5;
            
            while (!loginSuccessful && loginAttempts < maxLoginAttempts) {
                loginAttempts++;
                this.log(`[EVENT] Login attempt ${loginAttempts}/${maxLoginAttempts}`, 'detail', false);
                
                try {
                    // Check if login button is still visible (indicates CAPTCHA not completed)
                    const loginButton = page.locator('button#loginButton');
                    const isLoginButtonVisible = await loginButton.isVisible({ timeout: 5000 });
                    
                    if (isLoginButtonVisible) {
                        this.log('[EVENT] Login button still visible - CAPTCHA may need completion', 'detail', false);
                        
                        // Wait a bit longer for CAPTCHA completion
                        await page.waitForTimeout(10000);
                        
                        // Check if we can click the login button again
                        try {
                            await loginButton.click();
                            this.log('[EVENT] Clicked login button again', 'detail', false);
                        } catch (clickError) {
                            this.log('[DEBUG] Could not click login button, may be disabled', 'detail', false);
                        }
                    }
                    
                    // Check for successful login indicators
                    try {
                        await page.waitForURL('**/my/**', { timeout: 15000 });
                        loginSuccessful = true;
                        break;
                    } catch (urlError) {
                        // Continue to next attempt
                        this.log('[DEBUG] Still on login page, waiting for CAPTCHA completion', 'detail', false);
                        await page.waitForTimeout(5000);
                    }
                    
                    // Also check for dashboard elements
                    try {
                        await page.waitForSelector('div.addItemButton.blue', { state: 'visible', timeout: 10000 });
                        loginSuccessful = true;
                        break;
                    } catch (dashboardError) {
                        // Continue waiting
                    }
                    
                } catch (error) {
                    this.log(`[DEBUG] Login attempt ${loginAttempts} failed: ${error.message}`, 'detail', false);
                    await page.waitForTimeout(5000);
                }
            }
            
            if (!loginSuccessful) {
                throw new Error('Failed to complete login after CAPTCHA completion');
            }

            this.log('[EVENT] Login successful after CAPTCHA completion.', 'info', true);

            // Step 2: Wait for and click the add item button
            this.log('[EVENT] Looking for add item button...', 'detail', false);
            await page.waitForSelector('div.addItemButton.blue', { state: 'visible', timeout: 60000 });
            await page.locator('div.addItemButton.blue').click();
            this.log('[EVENT] Add item button clicked.', 'detail', false);

            // Step 3: Click the bookmark option
            this.log('[EVENT] Looking for bookmark option...', 'detail', false);
            await page.waitForSelector('div.add-type-item.link', { state: 'visible', timeout: 10000 });
            await page.locator('div.add-type-item.link').click();
            this.log('[EVENT] Bookmark option selected.', 'detail', false);

            // Step 4: Fill the URL input
            this.log('[EVENT] Filling URL input...', 'detail', false);
            const urlToBookmark = this.content.url || this.website.url;

            // Wait for the bookmark form to appear and use a more specific selector
            await page.waitForTimeout(2000); // Give time for the form to load

            // Try multiple selectors to find the correct URL input field
            let urlInput = null;
            const urlSelectors = [
                'span:has-text("BookmarkURL") input[type="text"]',
                'input[type="text"]:not(.inputArea)',
                'div:has-text("URL") input[type="text"]',
                'form input[type="text"]:not([placeholder*="Search"])'
            ];

            for (const selector of urlSelectors) {
                try {
                    await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
                    const elements = await page.locator(selector).all();
                    if (elements.length === 1) {
                        urlInput = page.locator(selector);
                        this.log(`[DEBUG] Found URL input with selector: ${selector}`, 'detail', false);
                        break;
                    }
                } catch (error) {
                    this.log(`[DEBUG] Selector ${selector} not found or multiple elements`, 'detail', false);
                }
            }

            if (!urlInput) {
                // Fallback: use the second input that's not the search box
                urlInput = page.locator('input[type="text"]').nth(1);
                this.log('[DEBUG] Using fallback selector: second text input', 'detail', false);
            }

            await urlInput.fill(urlToBookmark);
            this.log(`[EVENT] URL filled: ${urlToBookmark}`, 'detail', false);

            // Step 5: Click Next button
            this.log('[EVENT] Clicking Next button...', 'detail', false);
            await page.locator('button.ui.button.submitButton').first().click();
            this.log('[EVENT] Next button clicked.', 'detail', false);

            // Step 6: Fill the description textarea
            this.log('[EVENT] Filling description...', 'detail', false);
            await page.waitForSelector('textarea[rows="3"]', { state: 'visible', timeout: 10000 });
            
            // Clean the description for better SEO
            const rawDescription = this.content.body || this.content.description || this.content.title || 'Bookmarked content';
            const cleanDescription = this.cleanDescriptionForSEO(rawDescription);
            
            await page.locator('textarea[rows="3"]').fill(cleanDescription);
            this.log('[EVENT] Cleaned description filled.', 'detail', false);

            // Step 6b: Handle group sharing if available
            this.log('[EVENT] Checking for group sharing options...', 'detail', false);
            try {
                // Look for the share to group input
                const groupInput = page.locator('input[placeholder="Share to group"]');
                if (await groupInput.isVisible({ timeout: 3000 })) {
                    this.log('[EVENT] Found group sharing input, clicking...', 'detail', false);
                    await groupInput.click();
                    
                    // Wait for group options to appear
                    await page.waitForTimeout(2000);
                    
                    // Look for available group options
                    const groupSelectors = [
                        'div.group.element',
                        'div.group.selected',
                        '[class*="group"]'
                    ];
                    
                    let groupsFound = false;
                    for (const selector of groupSelectors) {
                        try {
                            const groupElements = await page.locator(selector).all();
                            if (groupElements.length > 0) {
                                this.log(`[EVENT] Found ${groupElements.length} group options`, 'detail', false);
                                
                                // Click on each available group option
                                for (let i = 0; i < groupElements.length; i++) {
                                    try {
                                        const groupText = await groupElements[i].textContent();
                                        this.log(`[EVENT] Selecting group: ${groupText}`, 'detail', false);
                                        await groupElements[i].click();
                                        await page.waitForTimeout(500); // Brief pause between selections
                                    } catch (groupError) {
                                        this.log(`[DEBUG] Could not select group ${i}: ${groupError.message}`, 'detail', false);
                                    }
                                }
                                groupsFound = true;
                                break;
                            }
                        } catch (error) {
                            this.log(`[DEBUG] Group selector ${selector} not found`, 'detail', false);
                        }
                    }
                    
                    if (!groupsFound) {
                        this.log('[DEBUG] No group options found, skipping group sharing', 'detail', false);
                    }
                } else {
                    this.log('[DEBUG] No group sharing input found, skipping', 'detail', false);
                }
            } catch (groupError) {
                this.log(`[DEBUG] Group sharing not available: ${groupError.message}`, 'detail', false);
            }

            // Step 7: Click Add button
            this.log('[EVENT] Clicking Add button...', 'detail', false);
            await page.locator('button.ui.button.submitButton').click();
            this.log('[EVENT] Add button clicked. Waiting for bookmark to be created...', 'detail', false);

            // Step 8: Wait for the bookmark to be created and look for the menu icon
            this.log('[EVENT] Looking for menu icon...', 'detail', false);
            await page.waitForSelector('i.link.vertical.ellipsis.icon', { state: 'visible', timeout: 15000 });
            
            // Click the first menu icon (for the latest item)
            await page.locator('i.link.vertical.ellipsis.icon').first().click();
            this.log('[EVENT] Menu icon clicked.', 'detail', false);

            // Step 9: Click "Get shareable link"
            this.log('[EVENT] Looking for shareable link option...', 'detail', false);

            // Wait a moment for the menu to fully load
            await page.waitForTimeout(2000);

            // Try multiple approaches to find the shareable link option
            let shareableLinkClicked = false;

            // Approach 1: Look for text containing "shareable" or "share"
            const shareableSelectors = [
                'div.menu-item:has-text("Get shareable link")',
                'div.menu-item:has-text("shareable")',
                'div.menu-item:has-text("Share")',
                'div.menu-item:has-text("share")',
                '[role="menuitem"]:has-text("shareable")',
                '[role="menuitem"]:has-text("Share")'
            ];

            for (const selector of shareableSelectors) {
                try {
                    const element = page.locator(selector).first();
                    if (await element.isVisible({ timeout: 2000 })) {
                        await element.click();
                        this.log(`[EVENT] Shareable link option clicked using selector: ${selector}`, 'detail', false);
                        shareableLinkClicked = true;
                        break;
                    }
                } catch (error) {
                    this.log(`[DEBUG] Selector ${selector} not found`, 'detail', false);
                }
            }

            // Approach 2: If not found, look through all menu items for share-related text
            if (!shareableLinkClicked) {
                this.log('[DEBUG] Trying to find shareable link in all menu items...', 'detail', false);
                const allMenuItems = await page.locator('div.menu-item').all();

                for (let i = 0; i < allMenuItems.length; i++) {
                    try {
                        const text = await allMenuItems[i].textContent();
                        if (text && (text.toLowerCase().includes('share') || text.toLowerCase().includes('link'))) {
                            this.log(`[DEBUG] Found potential share option: "${text}"`, 'detail', false);
                            await allMenuItems[i].click();
                            shareableLinkClicked = true;
                            break;
                        }
                    } catch (error) {
                        // Continue to next item
                    }
                }
            }

            if (!shareableLinkClicked) {
                throw new Error('Could not find shareable link option in menu');
            }

            // Step 10: Extract the shareable URL
            this.log('[EVENT] Extracting shareable URL...', 'detail', false);
            
            // Wait a moment for the URL to be generated and displayed
            await page.waitForTimeout(2000);
            
            // The shareable URL should appear in the current page URL or in a modal/popup
            // Let's check if we're redirected to a diigo.com/xxxxx URL
            const currentUrl = page.url();
            let shareableUrl = null;
            
            if (currentUrl.includes('diigo.com/') && currentUrl !== this.baseUrl) {
                shareableUrl = currentUrl;
            } else {
                // If not redirected, look for the URL in the page content
                try {
                    // Look for any element that might contain the shareable URL
                    const urlElements = await page.locator('text=/diigo\\.com\\/[a-zA-Z0-9]+/').all();
                    if (urlElements.length > 0) {
                        shareableUrl = await urlElements[0].textContent();
                    }
                } catch (error) {
                    this.log('[WARNING] Could not find shareable URL in page content.', 'warning', true);
                }
            }

            if (!shareableUrl) {
                // Fallback: use the current URL if it looks like a Diigo bookmark
                if (currentUrl.includes('diigo.com')) {
                    shareableUrl = currentUrl;
                } else {
                    throw new Error('Could not extract shareable URL from Diigo');
                }
            }

            this.log(`[SUCCESS] Bookmark created successfully! Shareable URL: ${shareableUrl}`, 'success', true);

            // Take screenshot
            const screenshotPath = `screenshot_completion_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            this.log('[EVENT] Screenshot taken after completion.', 'info', true);

            // Upload screenshot to Cloudinary
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            this.logScreenshotUploaded(cloudinaryUrl);
            fs.unlinkSync(screenshotPath);

            return { 
                success: true, 
                postUrl: shareableUrl, 
                cloudinaryUrl: cloudinaryUrl 
            };

        } catch (error) {
            this.log(`\n--- [SCRIPT ERROR] ---`, 'error', true);
            this.log(`[ERROR] Global script error: ${error.message}`, 'error', true);
            this.log('----------------------', 'error', true);
            this.log('[EVENT] An error occurred.', 'error', true);

            // Take error screenshot if possible
            if (page) {
                try {
                    const errorScreenshotPath = `screenshot_error_${this.requestId}.png`;
                    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
                    const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
                    this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
                    fs.unlinkSync(errorScreenshotPath);
                } catch (screenshotError) {
                    this.log(`[ERROR] Could not take error screenshot: ${screenshotError.message}`, 'error', true);
                }
            }

            throw error;
        } finally {
            if (browser) {
                await browser.close();
                this.log('[EVENT] Browser closed after execution.', 'detail', false);
            } else {
                this.log('[EVENT] Browser instance was not created or was null.', 'warning', true);
            }
        }
    }
}

export default DiigoAdapter;
