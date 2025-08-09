import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import BaseAdapter from '../BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DiigoForumsAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.loginUrl = 'https://www.diigo.com/sign-in?referInfo=https%3A%2F%2Fwww.diigo.com';
        this.baseUrl = 'https://www.diigo.com';
        this.extensionPath = path.join(__dirname, '../../recaptcha-solver');

        // Category mapping based on LLM response
        this.categoryGroups = {
            'Business': [
                'https://groups.diigo.com/group/smetimes-business-news',
                'https://groups.diigo.com/group/Sopping-India',
                'https://groups.diigo.com/group/investment-personal-finance',
                'https://groups.diigo.com/group/business',
                'https://groups.diigo.com/group/realtor'
            ],
            'Finance': [
                'https://groups.diigo.com/group/investment-personal-finance',
                'https://groups.diigo.com/group/business',
                'https://groups.diigo.com/group/realtor'
            ],
            'Technology': [
                'https://groups.diigo.com/group/Diigo_HQ',
                'https://groups.diigo.com/group/wedesign',
                'https://groups.diigo.com/group/future-of-the-web',
                'https://groups.diigo.com/group/web2tools',
                'https://groups.diigo.com/group/Web2'
            ],
            'Gaming': [
                'https://groups.diigo.com/group/future-of-the-web',
                'https://groups.diigo.com/group/web2tools'
            ],
            'Health': [
                'https://groups.diigo.com/group/collaboration',
                'https://groups.diigo.com/group/ksudigg'
            ],
            'Education': [
                'https://groups.diigo.com/group/ksudigg',
                'https://groups.diigo.com/group/collaboration'
            ],
            'Travel': [
                'https://groups.diigo.com/group/weddings',
                'https://groups.diigo.com/group/bpoelks'
            ],
            'Lifestyle': [
                'https://groups.diigo.com/group/weddings',
                'https://groups.diigo.com/group/art-and-fashion',
                'https://groups.diigo.com/group/digital_desing'
            ],
            'News': [
                'https://groups.diigo.com/group/smetimes-business-news',
                'https://groups.diigo.com/group/everything-about-entertainment'
            ],
            'Entertainment': [
                'https://groups.diigo.com/group/everything-about-entertainment',
                'https://groups.diigo.com/group/aigeneral',
                'https://groups.diigo.com/group/fun_masti',
                'https://groups.diigo.com/group/entertain',
                'https://groups.diigo.com/group/art-and-fashion'
            ]
        };
    }

    /**
     * Clean description text for better SEO by removing URLs and brackets
     * @param {string} text - Raw description text
     * @returns {string} - Cleaned description text
     */
    cleanDescriptionForSEO(text) {
        if (!text || typeof text !== 'string') {
            return 'Posted content';
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

        return cleaned || 'Posted content';
    }

    /**
     * Determine the appropriate category using LLM API
     * @param {Object} contentData - Content data from request
     * @returns {Promise<string[]>} - Array of categories
     */
    async determineCategory(contentData) {
        try {
            const prompt = this.buildCategoryPrompt(contentData);
            console.log("prompt: ", prompt)
            const response = await fetch('http://31.97.229.2:3009/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer no-key'
                },
                body: JSON.stringify({
                    model: 'Meta-Llama-3.1-8B-Instruct.Q6_K.gguf',
                    temperature: 0,
                    max_tokens: 30,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a JSON-only generator. You must output ONLY a valid JSON array from this fixed list: ["Business", "Gaming", "SEO", "Health", "Education", "Technology", "Finance", "Travel", "Lifestyle", "News"]. Example: ["Technology", "SEO"]. No explanations or additional text.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                })
            });

            const data = await response.json();
            let rawContent = data.choices[0].message.content;

            console.log("Raw LLM response:", rawContent);

            // Clean up the response - remove <|eot_id|> and other tokens
            rawContent = rawContent.replace(/<\|eot_id\|>/g, '').trim();

            let categories = [];

            try {
                // First try to parse as JSON array
                if (rawContent.startsWith('[') && rawContent.includes(']')) {
                    // Extract JSON array using regex
                    const jsonMatch = rawContent.match(/\[.*?\]/);
                    if (jsonMatch) {
                        categories = JSON.parse(jsonMatch[0]);
                    }
                } else {
                    // Parse numbered list or bullet point format
                    // Look for patterns like "1. Technology", "2. News", "1Technology2News3Business"
                    const numberedMatches = rawContent.match(/\d+\.?\s*([A-Za-z]+)/g);
                    if (numberedMatches && numberedMatches.length > 0) {
                        categories = numberedMatches.map(match => 
                            match.replace(/^\d+\.?\s*/, '').trim()
                        ).filter(cat => cat.length > 0);
                        console.log("Found numbered categories:", categories);
                    } else {
                        // Fallback to bullet point or line-separated format
                        const categoryMatches = rawContent.match(/(?:\*\s*|\-\s*|^\s*)([A-Za-z_]+)(?:\s*$|\s*\n)/gm);
                        if (categoryMatches) {
                            categories = categoryMatches.map(match =>
                                match.replace(/^\s*[\*\-]\s*/, '').trim()
                            ).filter(cat => cat.length > 0);
                        }
                    }
                }

                // Fallback: if no categories found, try to extract any valid category names
                if (categories.length === 0) {
                    const validCategories = ["Business", "Gaming", "SEO", "Health", "Education", "Technology", "Finance", "Travel", "Lifestyle", "News"];
                    categories = validCategories.filter(cat =>
                        rawContent.toLowerCase().includes(cat.toLowerCase())
                    );
                }

                console.log("Parsed categories:", categories);

            } catch (parseError) {
                console.log("Failed to parse LLM response:", parseError.message);
                // Fallback to Technology if parsing fails
                categories = ['Technology'];
            }

            this.log(`[EVENT] LLM determined categories: ${categories.join(', ')}`, 'info', true);
            console.log("Categories for Diigo forum:", `${categories.join(', ')}`);
            return categories;

        } catch (error) {
            this.log(`[ERROR] Failed to determine category: ${error.message}`, 'error', true);
            // Fallback to Technology category
            return ['Technology'];
        }
    }

    /**
     * Build prompt for LLM category determination
     * @param {Object} contentData - Content data
     * @returns {string} - Formatted prompt
     */
    buildCategoryPrompt(contentData) {
        const website = contentData.website || {};
        const content = contentData.content || {};

        // Access user info from the job data structure
        // Handle both old format (reqBody) and new format (direct fields)
        const reqBody = this.job?.data?.reqBody || this.job?.data || {};
        const userInfo = reqBody?.content?.info?.user || {};
        const businessInfo = reqBody?.content?.info || {};
        const extractedContent = reqBody?.content || {};

        let prompt = '';

        // Personal Information
        if (userInfo.first_name && userInfo.last_name) {
            prompt += `I am ${userInfo.first_name} ${userInfo.last_name}, `;
        } else if (userInfo.full_name) {
            prompt += `I am ${userInfo.full_name}, `;
        }

        // Professional Role & Designation
        if (userInfo.designation) {
            prompt += `working as ${userInfo.designation}, `;
        }

        // Location Details
        if (userInfo.country) {
            prompt += `based in ${userInfo.country}`;
            if (userInfo.state) prompt += `, ${userInfo.state}`;
            if (userInfo.city) prompt += `, ${userInfo.city}`;
            prompt += '. ';
        }

        // Business Type & Account Type
        if (userInfo.account_type) {
            prompt += `I run an ${userInfo.account_type} business `;
        }

        if (userInfo.business_type) {
            prompt += `in the ${userInfo.business_type} sector `;
        }

        // Business Categories (Primary)
        if (userInfo.business_categories && userInfo.business_categories.length > 0) {
            prompt += `specializing in ${userInfo.business_categories.join(', ')}. `;
        }

        // Business Websites
        if (userInfo.company_website) {
            prompt += `My main business website is ${userInfo.company_website}. `;
        }
        if (userInfo.public_website_1) {
            prompt += `My primary public website is ${userInfo.public_website_1}. `;
        }
        if (userInfo.public_website_2) {
            prompt += `My secondary website is ${userInfo.public_website_2}. `;
        }



        // Business Description & Bio
        if (userInfo.about_business_description) {
            prompt += `About my business: ${userInfo.about_business_description}. `;
        }
        if (userInfo.company_bio) {
            prompt += `Company background: ${userInfo.company_bio}. `;
        }
        if (userInfo.author_bio) {
            prompt += `My professional bio: ${userInfo.author_bio}. `;
        }

        // Target Audience & Market
        if (userInfo.target_audience) {
            prompt += `My target audience includes: ${userInfo.target_audience}. `;
        }
        if (userInfo.target_geo_location) {
            prompt += `I primarily target customers in: ${userInfo.target_geo_location}. `;
        }
        if (userInfo.target_keywords) {
            prompt += `Key topics I focus on: ${userInfo.target_keywords}. `;
        }

        // Content Information (most relevant for category determination)
        if (content.title && content.title !== 'Untitled') {
            prompt += `Today I'm posting content titled: "${content.title}". `;
        }

        if (content.body || content.description) {
            const contentText = (content.body || content.description).substring(0, 300);
            prompt += `The content details: ${contentText}. `;
        }

        // Current posting context
        if (businessInfo.category) {
            prompt += `This content is being posted in the ${businessInfo.category} category. `;
        }

        prompt += 'Based on all this information about me, my business, and the content I\'m posting, please determine the most appropriate categories for this content distribution.';

        console.log("Comprehensive Prompt is:", prompt);

        return prompt;
    }

    /**
     * Get appropriate group URLs based on categories
     * @param {string[]} categories - Array of categories
     * @returns {string[]} - Array of group URLs
     */
    getGroupUrls(categories) {
        const groupUrls = new Set();

        categories.forEach(category => {
            const urls = this.categoryGroups[category] || [];
            urls.forEach(url => groupUrls.add(url));
        });

        return Array.from(groupUrls);
    }

    async publish() {
        this.log(`[EVENT] Entering DiigoForumsAdapter publish method.`, 'info', true);
        let browser;
        let page;

        try {
            // Step 1: Extract user data from job structure
            const reqBody = this.job?.data?.reqBody || this.job?.data || {};
            const userInfo = reqBody?.content?.info?.user || {};
            const businessInfo = reqBody?.content?.info || {};
            const extractedContent = reqBody?.content || {};

            // Step 2: Determine category using LLM (before browser launch)
            this.log('[EVENT] Determining appropriate category using LLM...', 'detail', false);
            const categories = await this.determineCategory({
                website: this.website,
                content: this.content
            });

            // Step 2: Launch browser with CAPTCHA solver extension
            this.log('[DEBUG] Launching Chromium with CAPTCHA solver extension...', 'detail', false);
            this.log(`[DEBUG] Extension path: ${this.extensionPath}`, 'detail', false);

            const userDataDir = './tmp-user-data-dir-diigo-forums';

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

            // Step 3: Navigate to login page and login
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

            // Step 3: Get group URLs for the determined categories
            const groupUrls = this.getGroupUrls(categories);
            this.log(`[EVENT] Available groups for categories [${categories.join(', ')}]: ${groupUrls.join(', ')}`, 'info', true);

            if (groupUrls.length === 0) {
                throw new Error(`No groups found for categories: ${categories.join(', ')}`);
            }

            // Step 4: Randomly pick a group URL
            const randomGroupUrl = groupUrls[Math.floor(Math.random() * groupUrls.length)];
            this.log(`[EVENT] Randomly selected group: ${randomGroupUrl}`, 'info', true);

            // Step 5: Extract group name and join directly (no need to check anything)
            const groupNameMatch = randomGroupUrl.match(/\/group\/([^\/]+)/);
            if (groupNameMatch) {
                const groupName = groupNameMatch[1];
                const joinUrl = `https://groups.diigo.com/group_mana/join_group?group_name=${groupName}`;
                
                this.log(`[EVENT] Joining group directly via: ${joinUrl}`, 'info', true);
                await page.goto(joinUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
                
                this.log('[EVENT] Successfully joined group', 'info', true);
            }
            
            // Step 6: Navigate to the group page
            this.log(`[EVENT] Navigating to group: ${randomGroupUrl}`, 'detail', false);
            await page.goto(randomGroupUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);

            // Step 6: Wait for page to load completely and check group membership
            this.log('[EVENT] Waiting for page to load completely...', 'detail', false);
            await page.waitForTimeout(5000); // Let the page load fully
            
            this.log('[EVENT] Checking if we need to join this group...', 'detail', false);

            try {
                // Check for "Apply to join group" first - if found, skip this group
                const applyButton = page.locator('a:has-text("Apply to join group"), button:has-text("Apply to join group")');
                const isApplyButtonVisible = await applyButton.isVisible({ timeout: 3000 });

                if (isApplyButtonVisible) {
                    this.log('[EVENT] Found "Apply to join group" - this group requires approval. Skipping to try another group...', 'warning', true);

                    // Get a different group URL and try again
                    const remainingGroups = groupUrls.filter(url => url !== randomGroupUrl);
                    if (remainingGroups.length > 0) {
                        const newRandomGroupUrl = remainingGroups[Math.floor(Math.random() * remainingGroups.length)];
                        this.log(`[EVENT] Trying different group: ${newRandomGroupUrl}`, 'info', true);

                        await page.goto(newRandomGroupUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(5000);

                        // Check this new group for apply button too
                        const newApplyButton = page.locator('a:has-text("Apply to join group"), button:has-text("Apply to join group")');
                        const isNewApplyButtonVisible = await newApplyButton.isVisible({ timeout: 3000 });

                        if (isNewApplyButtonVisible) {
                            this.log('[EVENT] Second group also requires approval. Proceeding anyway...', 'warning', true);
                        }
                    }
                }

                // Look for the "Join this group" button and extract group name for direct join
                const joinButton = page.locator('a.inviteBtn:has-text("Join this group")');
                const isJoinButtonVisible = await joinButton.isVisible({ timeout: 5000 });

                if (isJoinButtonVisible) {
                    // Extract group name from current URL or join button href
                    const currentUrl = page.url();
                    const groupNameMatch = currentUrl.match(/\/group\/([^\/]+)/);
                    
                    if (groupNameMatch) {
                        const groupName = groupNameMatch[1];
                        const joinUrl = `https://groups.diigo.com/group_mana/join_group?group_name=${groupName}`;
                        
                        this.log(`[EVENT] Found "Join this group" button - joining directly via: ${joinUrl}`, 'info', true);
                        await page.goto(joinUrl, { waitUntil: 'domcontentloaded' });
                        
                        // Wait a moment for the join to process
                        await page.waitForTimeout(2000);
                        
                        // Navigate back to the group page
                        await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(3000);
                        
                        this.log('[EVENT] Successfully joined group and returned to group page', 'info', true);
                    } else {
                        this.log('[EVENT] Could not extract group name from URL, proceeding without joining', 'warning', true);
                    }

                } else {
                    this.log('[EVENT] No "Join this group" button found - we are likely already a member', 'info', true);
                }

            } catch (joinError) {
                this.log('[EVENT] Could not find join button - we are likely already a member of this group', 'info', true);
            }

            // Step 8: Now we are part of the group, create a bookmark post
            this.log('[EVENT] Now part of the group, creating bookmark post...', 'info', true);

            // Step 8a: Find and click the "Bookmark" link with multiple selectors
            this.log('[EVENT] Looking for Bookmark link...', 'detail', false);
            try {
                // Try multiple possible selectors for the bookmark link
                const possibleSelectors = [
                    'a.pLink#post_item_bookmark',
                    'a#post_item_bookmark',
                    'a[href*="bookmark"]',
                    'a:has-text("Bookmark")',
                    '.pLink:has-text("Bookmark")',
                    'a.menuItem:has-text("Bookmark")'
                ];

                let bookmarkLink = null;
                let foundSelector = null;

                for (const selector of possibleSelectors) {
                    try {
                        bookmarkLink = page.locator(selector).first();
                        await bookmarkLink.waitFor({ state: 'visible', timeout: 3000 });
                        foundSelector = selector;
                        this.log(`[EVENT] Found Bookmark link with selector: ${selector}`, 'info', true);
                        break;
                    } catch (selectorError) {
                        this.log(`[DEBUG] Selector ${selector} not found, trying next...`, 'detail', false);
                        continue;
                    }
                }

                if (!bookmarkLink || !foundSelector) {
                    // Take a screenshot to see what's available on the page
                    const debugScreenshotPath = `screenshot_debug_${this.requestId}.png`;
                    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
                    const debugCloudinaryResult = await cloudinary.uploader.upload(debugScreenshotPath);
                    fs.unlinkSync(debugScreenshotPath);
                    this.log(`[DEBUG] Debug screenshot uploaded: ${debugCloudinaryResult.secure_url}`, 'info', true);
                    
                    throw new Error('Could not find Bookmark link with any of the attempted selectors');
                }

                this.log('[EVENT] Clicking Bookmark link...', 'info', true);
                await bookmarkLink.click();

                // Wait longer for the bookmark form to appear and take a screenshot
                await page.waitForTimeout(5000);
                
                // Take a screenshot to see what's on the page after clicking bookmark
                const afterBookmarkScreenshotPath = `screenshot_after_bookmark_${this.requestId}.png`;
                await page.screenshot({ path: afterBookmarkScreenshotPath, fullPage: true });
                const afterBookmarkCloudinaryResult = await cloudinary.uploader.upload(afterBookmarkScreenshotPath);
                fs.unlinkSync(afterBookmarkScreenshotPath);
                this.log(`[DEBUG] After bookmark click screenshot: ${afterBookmarkCloudinaryResult.secure_url}`, 'info', true);

                // Debug: Check what input elements are available on the page
                const allInputs = await page.locator('input').all();
                this.log(`[DEBUG] Found ${allInputs.length} input elements on page`, 'info', true);
                
                for (let i = 0; i < Math.min(allInputs.length, 10); i++) {
                    try {
                        const input = allInputs[i];
                        const tagName = await input.evaluate(el => el.tagName);
                        const type = await input.evaluate(el => el.type || 'text');
                        const name = await input.evaluate(el => el.name || '');
                        const id = await input.evaluate(el => el.id || '');
                        const placeholder = await input.evaluate(el => el.placeholder || '');
                        this.log(`[DEBUG] Input ${i}: ${tagName} type="${type}" name="${name}" id="${id}" placeholder="${placeholder}"`, 'info', true);
                    } catch (debugError) {
                        this.log(`[DEBUG] Could not inspect input ${i}: ${debugError.message}`, 'detail', false);
                    }
                }

            } catch (bookmarkLinkError) {
                throw new Error(`Could not find or click Bookmark link: ${bookmarkLinkError.message}`);
            }

            // Step 8b: Fill the URL field with multiple selectors
            this.log('[EVENT] Filling URL field...', 'detail', false);
            try {
                // Try multiple possible selectors for the URL input
                const possibleUrlSelectors = [
                    'input#bookmark_item_url[name="url"]',
                    'input[name="url"]',
                    'input#bookmark_item_url',
                    'input[placeholder*="URL"]',
                    'input[placeholder*="url"]',
                    'input[type="url"]'
                ];

                let urlInput = null;
                let foundUrlSelector = null;

                for (const selector of possibleUrlSelectors) {
                    try {
                        urlInput = page.locator(selector).first();
                        await urlInput.waitFor({ state: 'visible', timeout: 3000 });
                        foundUrlSelector = selector;
                        this.log(`[EVENT] Found URL input with selector: ${selector}`, 'info', true);
                        break;
                    } catch (selectorError) {
                        this.log(`[DEBUG] URL selector ${selector} not found, trying next...`, 'detail', false);
                        continue;
                    }
                }

                if (!urlInput || !foundUrlSelector) {
                    // Take a screenshot to see what's available on the page
                    const debugScreenshotPath = `screenshot_url_debug_${this.requestId}.png`;
                    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
                    const debugCloudinaryResult = await cloudinary.uploader.upload(debugScreenshotPath);
                    fs.unlinkSync(debugScreenshotPath);
                    this.log(`[DEBUG] URL debug screenshot uploaded: ${debugCloudinaryResult.secure_url}`, 'info', true);
                    
                    throw new Error('Could not find URL input field with any of the attempted selectors');
                }

                // Get URL from content data
                const urlToPost = extractedContent.url || userInfo.company_website || userInfo.public_website_1 || 'https://example.com';
                await urlInput.fill(urlToPost);
                this.log(`[EVENT] Filled URL: ${urlToPost}`, 'info', true);

                // Click Next button (required to make comment field visible)
                try {
                    const possibleNextSelectors = [
                        'button#next_step',
                        'input[type="submit"]',
                        'button:has-text("Next")',
                        'input[value="Next"]',
                        '#next_step'
                    ];

                    let nextButton = null;
                    let foundNextSelector = null;

                    for (const selector of possibleNextSelectors) {
                        try {
                            nextButton = page.locator(selector).first();
                            await nextButton.waitFor({ state: 'visible', timeout: 3000 });
                            foundNextSelector = selector;
                            this.log(`[EVENT] Found Next button with selector: ${selector}`, 'info', true);
                            break;
                        } catch (selectorError) {
                            this.log(`[DEBUG] Next selector ${selector} not found, trying next...`, 'detail', false);
                            continue;
                        }
                    }

                    if (nextButton && foundNextSelector) {
                        await nextButton.click();
                        this.log('[EVENT] Clicked Next button - waiting for comment field to become visible', 'info', true);

                        // Wait longer for next form elements to appear
                        await page.waitForTimeout(5000);
                    } else {
                        this.log('[WARNING] Could not find Next button with any selector', 'warning', true);
                    }

                } catch (nextError) {
                    this.log(`[WARNING] Error clicking Next button: ${nextError.message}`, 'warning', true);
                }

            } catch (urlError) {
                throw new Error(`Could not fill URL field: ${urlError.message}`);
            }

            // Step 8c: Clear auto-filled title and fill our own title
            this.log('[EVENT] Clearing auto-filled title and filling our own...', 'detail', false);
            try {
                const titleInput = page.locator('input#bookmark_item_title[name="title"]');
                await titleInput.waitFor({ state: 'visible', timeout: 10000 });
                
                // Clear the auto-filled title
                await titleInput.selectText();
                await titleInput.press('Delete');
                
                // Fill with our own title
                let titleToUse = '';
                if (extractedContent.title && extractedContent.title !== 'Untitled') {
                    titleToUse = extractedContent.title;
                } else {
                    // Create a meaningful title from user's business info
                    titleToUse = `${userInfo.first_name || 'Business'} ${userInfo.business_categories ? userInfo.business_categories.join(' & ') : 'Resource'} - ${userInfo.company_website || 'Professional Services'}`;
                }
                
                await titleInput.fill(titleToUse);
                this.log(`[EVENT] Filled title: ${titleToUse}`, 'info', true);
                
            } catch (titleError) {
                this.log(`[WARNING] Could not fill title field: ${titleError.message}`, 'warning', true);
                // Continue without custom title - not critical for success
            }

            // Step 8d: Fill the comment/content textarea with multiple selectors and increased timeout
            this.log('[EVENT] Filling comment/content field...', 'detail', false);
            try {
                // Try multiple possible selectors for the comment textarea
                const possibleCommentSelectors = [
                    'textarea#bookmark_item_content[name="comment"]',
                    'textarea[name="comment"]',
                    'textarea#bookmark_item_content',
                    'textarea[placeholder*="comment"]',
                    'textarea[placeholder*="description"]',
                    'textarea.inputTxt2'
                ];

                let commentTextarea = null;
                let foundCommentSelector = null;

                for (const selector of possibleCommentSelectors) {
                    try {
                        commentTextarea = page.locator(selector).first();
                        await commentTextarea.waitFor({ state: 'visible', timeout: 15000 }); // Increased timeout
                        foundCommentSelector = selector;
                        this.log(`[EVENT] Found comment textarea with selector: ${selector}`, 'info', true);
                        break;
                    } catch (selectorError) {
                        this.log(`[DEBUG] Comment selector ${selector} not found, trying next...`, 'detail', false);
                        continue;
                    }
                }

                if (!commentTextarea || !foundCommentSelector) {
                    // Take a screenshot to see what's available on the page
                    const debugCommentScreenshotPath = `screenshot_comment_debug_${this.requestId}.png`;
                    await page.screenshot({ path: debugCommentScreenshotPath, fullPage: true });
                    const debugCommentCloudinaryResult = await cloudinary.uploader.upload(debugCommentScreenshotPath);
                    fs.unlinkSync(debugCommentScreenshotPath);
                    this.log(`[DEBUG] Comment debug screenshot uploaded: ${debugCommentCloudinaryResult.secure_url}`, 'info', true);
                    
                    throw new Error('Could not find comment textarea with any of the attempted selectors');
                }

                // Create content from title and description
                let contentToPost = '';
                if (extractedContent.title && extractedContent.title !== 'Untitled') {
                    contentToPost += extractedContent.title;
                }
                if (extractedContent.description) {
                    let cleanDescription = extractedContent.description;
                    // Remove URLs and brackets from description
                    cleanDescription = cleanDescription.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Remove [text](url) format
                    cleanDescription = cleanDescription.replace(/\[([^\]]+)\]/g, '$1'); // Remove [text] format
                    cleanDescription = cleanDescription.replace(/\([^)]*https?:\/\/[^)]*\)/g, ''); // Remove (url) format
                    cleanDescription = cleanDescription.replace(/https?:\/\/[^\s]+/g, ''); // Remove standalone URLs
                    cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim(); // Clean up extra spaces
                    
                    contentToPost += (contentToPost ? '\n\n' : '') + cleanDescription;
                } else if (extractedContent.body) {
                    let cleanBody = extractedContent.body.substring(0, 500);
                    // Clean body content too
                    cleanBody = cleanBody.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                    cleanBody = cleanBody.replace(/\[([^\]]+)\]/g, '$1');
                    cleanBody = cleanBody.replace(/\([^)]*https?:\/\/[^)]*\)/g, '');
                    cleanBody = cleanBody.replace(/https?:\/\/[^\s]+/g, '');
                    cleanBody = cleanBody.replace(/\s+/g, ' ').trim();
                    
                    contentToPost += (contentToPost ? '\n\n' : '') + cleanBody;
                }

                // Fallback content if nothing available
                if (!contentToPost.trim()) {
                    contentToPost = `Check out this great resource from ${userInfo.first_name || 'our'} ${userInfo.business_categories ? userInfo.business_categories.join(' & ') : 'business'}!`;
                }

                await commentTextarea.fill(contentToPost);
                this.log(`[EVENT] Filled content: ${contentToPost.substring(0, 100)}...`, 'info', true);

            } catch (commentError) {
                throw new Error(`Could not fill comment field: ${commentError.message}`);
            }

            // Step 8d: Fill the tags field with keywords
            this.log('[EVENT] Filling tags field...', 'detail', false);
            try {
                const tagsInput = page.locator('input#link_item_tags[name="tags"]');
                await tagsInput.waitFor({ state: 'visible', timeout: 10000 });

                // Create tags from business categories, target keywords, and content
                let tags = [];

                // Add business categories as tags
                if (userInfo.business_categories) {
                    tags.push(...userInfo.business_categories);
                }

                // Add target keywords if available
                if (userInfo.target_keywords) {
                    const keywords = userInfo.target_keywords.split(',').map(k => k.trim());
                    tags.push(...keywords);
                }

                // Add determined categories as tags
                tags.push(...categories);

                // Add some generic relevant tags
                tags.push('business', 'resources', 'tools');

                // Remove duplicates and join with spaces
                const uniqueTags = [...new Set(tags)].filter(tag => tag && tag.length > 0);
                const tagsString = uniqueTags.join(' ');

                await tagsInput.fill(tagsString);
                this.log(`[EVENT] Filled tags: ${tagsString}`, 'info', true);

            } catch (tagsError) {
                throw new Error(`Could not fill tags field: ${tagsError.message}`);
            }

            // Step 8e: Click the Post button
            this.log('[EVENT] Submitting the bookmark post...', 'detail', false);
            try {
                const postButton = page.locator('input.firstIBtn[type="submit"][value="Post"]');
                await postButton.waitFor({ state: 'visible', timeout: 10000 });

                this.log('[EVENT] Found Post button - submitting...', 'info', true);
                await postButton.click();
                
                // Wait for the post to be processed (no navigation happens)
                await page.waitForTimeout(5000);

                this.log('[EVENT] Bookmark post submitted successfully!', 'success', true);

            } catch (postError) {
                throw new Error(`Could not submit post: ${postError.message}`);
            }

            // Step 9: Get the permalink by clicking "more" dropdown
            this.log('[EVENT] Getting permalink from more menu...', 'detail', false);
            let permalink = null;

            try {
                // Find and click the "more" dropdown
                const moreButton = page.locator('a.menuItem:has-text("more")').first();
                await moreButton.waitFor({ state: 'visible', timeout: 10000 });
                this.log('[EVENT] Found "more" dropdown - clicking...', 'info', true);
                await moreButton.click();

                // Wait for dropdown menu to appear
                await page.waitForTimeout(2000);

                // Look for "Link to this item" link
                const linkToItemElement = page.locator('a[href*="/content/"]:has-text("Link to this item")');
                await linkToItemElement.waitFor({ state: 'visible', timeout: 10000 });

                // Get the href attribute which contains the permalink
                permalink = await linkToItemElement.getAttribute('href');
                this.log(`[EVENT] Found permalink: ${permalink}`, 'success', true);

            } catch (permalinkError) {
                this.log(`[WARNING] Could not get permalink: ${permalinkError.message}`, 'warning', true);
                // Continue without permalink - not critical for success
            }

            // Step 10: Take final screenshot for verification
            const finalUrl = page.url();
            const screenshotPath = `screenshot_final_${this.requestId}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            const cloudinaryUploadResult = await cloudinary.uploader.upload(screenshotPath);
            const cloudinaryUrl = cloudinaryUploadResult.secure_url;
            fs.unlinkSync(screenshotPath);
            this.logScreenshotUploaded(cloudinaryUrl);

            // Use permalink as the final post URL if available, otherwise use current page URL
            const finalPostUrl = permalink || finalUrl;
            this.logPublicationSuccess(finalPostUrl);

            return {
                success: true,
                categories: categories,
                selectedGroup: randomGroupUrl,
                postUrl: finalPostUrl,
                permalink: permalink,
                screenshotUrl: cloudinaryUrl,
                message: 'Diigo Forums bookmark post created successfully with permalink!'
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

export default DiigoForumsAdapter;
