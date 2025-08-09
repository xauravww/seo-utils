import { chromium } from 'patchright';
import cloudinary from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import BaseAdapter from '../BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DiigoBookmarkingAdapter extends BaseAdapter {
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
                            content: 'You are a JSON-only generator. You must output ONLY a valid JSON array from this EXACT fixed list: ["Business", "Finance", "Technology", "Gaming", "Health", "Education", "Travel", "Lifestyle", "News", "Entertainment"]. These are the ONLY valid categories. Do not suggest any other categories like "Bookmarking", "SEO", or anything else not in this list. Example: ["Technology", "News"]. No explanations or additional text.'
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
     * Get appropriate group URLs based on categories - only exact matches
     * @param {string[]} categories - Array of categories
     * @returns {string[]} - Array of group URLs
     */
    getGroupUrls(categories) {
        const groupUrls = new Set();

        // Only add groups for categories that exactly match the LLM-generated categories
        categories.forEach(category => {
            if (this.categoryGroups.hasOwnProperty(category)) {
                const urls = this.categoryGroups[category] || [];
                urls.forEach(url => groupUrls.add(url));
                this.log(`[EVENT] Added groups for category "${category}": ${urls.join(', ')}`, 'info', true);
            } else {
                this.log(`[WARNING] No groups found for category "${category}" - skipping`, 'warning', true);
            }
        });

        return Array.from(groupUrls);
    }

    /**
     * Add human-like random delay
     * @param {number} min - Minimum delay in ms
     * @param {number} max - Maximum delay in ms
     */
    async humanDelay(min = 1000, max = 3000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Human-like typing with random delays between keystrokes
     * @param {Object} element - Playwright locator
     * @param {string} text - Text to type
     */
    async humanType(element, text) {
        await element.click();
        await this.humanDelay(200, 500);

        for (let i = 0; i < text.length; i++) {
            await element.type(text[i]);
            await this.humanDelay(50, 150);
        }
    }

    /**
     * Human-like mouse movement and click
     * @param {Object} page - Playwright page
     * @param {Object} element - Playwright locator
     */
    async humanClick(page, element) {
        const box = await element.boundingBox();
        if (box) {
            // Move mouse to random position near the element
            const x = box.x + Math.random() * box.width;
            const y = box.y + Math.random() * box.height;

            await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
            await this.humanDelay(100, 300);
            await page.mouse.click(x, y);
        } else {
            await element.click();
        }
    }

    /**
     * Simulate human-like page scrolling
     * @param {Object} page - Playwright page
     */
    async humanScroll(page) {
        const scrollAmount = Math.floor(Math.random() * 300) + 100;
        await page.mouse.wheel(0, scrollAmount);
        await this.humanDelay(500, 1000);
    }

    async publish() {
        this.log(`[EVENT] Entering DiigoBookmarkingAdapter publish method.`, 'info', true);
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
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ],
                defaultViewport: { width: 1366, height: 768 },
                locale: 'en-US',
                timezoneId: 'America/New_York',
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

            // Step 3: Navigate to login page and login with human-like behavior
            this.log(`[EVENT] Navigating to login page: ${this.loginUrl}`, 'detail', false);
            await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
            await this.humanDelay(2000, 4000); // Human-like delay after page load
            this.log('[EVENT] Navigation to login page complete.', 'detail', false);

            // Simulate human browsing behavior
            await this.humanScroll(page);
            await this.humanDelay(1000, 2000);

            // Fill login form with human-like behavior
            this.log('[EVENT] Filling login form with human-like behavior...', 'detail', false);

            // Extract credentials with proper error handling
            const username = this.website.credentials?.username || this.website.credentials?.email || this.website.username || this.website.email;
            const password = this.website.credentials?.password || this.website.password;

            if (!username || !password) {
                throw new Error('Username/email and password are required for Diigo login');
            }

            this.log(`[DEBUG] Using username: ${username}`, 'detail', false);

            // Human-like form filling
            const usernameField = page.locator('input[name="Username"]');
            const passwordField = page.locator('input[name="password"]');

            // Click and type username with human-like behavior
            await this.humanClick(page, usernameField);
            await this.humanDelay(500, 1000);
            await this.humanType(usernameField, username);

            // Small delay before moving to password field
            await this.humanDelay(800, 1500);

            // Click and type password with human-like behavior
            await this.humanClick(page, passwordField);
            await this.humanDelay(500, 1000);
            await this.humanType(passwordField, password);

            this.log('[EVENT] Login form filled. Waiting for human-like delay before login...', 'detail', false);

            // Add human-like delay before attempting login
            await this.humanDelay(2000, 4000);

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
                        this.log('[EVENT] Login button still visible - attempting human-like click', 'detail', false);

                        // Add human-like behavior before clicking login
                        await this.humanScroll(page);
                        await this.humanDelay(1000, 2000);

                        // Use human-like click for login button
                        try {
                            await this.humanClick(page, loginButton);
                            this.log('[EVENT] Clicked login button with human-like behavior', 'detail', false);
                        } catch (clickError) {
                            this.log('[DEBUG] Could not click login button, may be disabled', 'detail', false);
                        }

                        // Wait longer for CAPTCHA completion with human-like behavior
                        await this.humanDelay(8000, 15000);
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
                const isJoinButtonVisible = await joinButton.isVisible({ timeout: 10000 });

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

                // Retry clicking bookmark button until URL field is found
                let urlInput = null;
                let foundUrlSelector = null;
                let bookmarkClickAttempts = 0;
                const maxBookmarkClickAttempts = 3;

                while (!urlInput && bookmarkClickAttempts < maxBookmarkClickAttempts) {
                    bookmarkClickAttempts++;
                    this.log(`[EVENT] Clicking Bookmark link (attempt ${bookmarkClickAttempts}/${maxBookmarkClickAttempts})...`, 'info', true);

                    // Use human-like click for bookmark link
                    await this.humanClick(page, bookmarkLink);
                    await this.humanDelay(2000, 4000);

                    // Try to find URL input field
                    const possibleUrlSelectors = [
                        'input#bookmark_item_url[name="url"]',
                        'input[name="url"]',
                        'input#bookmark_item_url',
                        'input[placeholder*="URL"]',
                        'input[placeholder*="url"]',
                        'input[type="url"]'
                    ];

                    for (const selector of possibleUrlSelectors) {
                        try {
                            urlInput = page.locator(selector).first();
                            await urlInput.waitFor({ state: 'visible', timeout: 2000 });
                            foundUrlSelector = selector;
                            this.log(`[EVENT] Found URL input with selector: ${selector}`, 'info', true);
                            break;
                        } catch (selectorError) {
                            this.log(`[DEBUG] URL selector ${selector} not found, trying next...`, 'detail', false);
                            continue;
                        }
                    }

                    if (urlInput) {
                        this.log(`[EVENT] URL field found after ${bookmarkClickAttempts} bookmark click attempts`, 'info', true);
                        break;
                    } else {
                        this.log(`[WARNING] URL field not found after bookmark click attempt ${bookmarkClickAttempts}`, 'warning', true);

                        // Take screenshot for debugging
                        const attemptScreenshotPath = `screenshot_bookmark_attempt_${bookmarkClickAttempts}_${this.requestId}.png`;
                        await page.screenshot({ path: attemptScreenshotPath, fullPage: true });
                        const attemptCloudinaryResult = await cloudinary.uploader.upload(attemptScreenshotPath);
                        fs.unlinkSync(attemptScreenshotPath);
                        this.log(`[DEBUG] Bookmark attempt ${bookmarkClickAttempts} screenshot: ${attemptCloudinaryResult.secure_url}`, 'info', true);

                        if (bookmarkClickAttempts < maxBookmarkClickAttempts) {
                            this.log('[EVENT] Retrying bookmark click...', 'info', true);
                            await page.waitForTimeout(2000);
                        }
                    }
                }

                if (!urlInput || !foundUrlSelector) {
                    // Take a final debug screenshot
                    const debugScreenshotPath = `screenshot_url_debug_final_${this.requestId}.png`;
                    await page.screenshot({ path: debugScreenshotPath, fullPage: true });
                    const debugCloudinaryResult = await cloudinary.uploader.upload(debugScreenshotPath);
                    fs.unlinkSync(debugScreenshotPath);
                    this.log(`[DEBUG] Final URL debug screenshot uploaded: ${debugCloudinaryResult.secure_url}`, 'info', true);

                    throw new Error(`Could not find URL input field after ${maxBookmarkClickAttempts} bookmark click attempts`);
                }

                // Step 8b: Fill the URL field with human-like behavior (moved inside the same try block)
                this.log('[EVENT] Filling URL field with human-like behavior...', 'detail', false);

                // Get URL from content data
                const urlToPost = extractedContent.url || userInfo.company_website || userInfo.public_website_1 || 'https://example.com';

                // Use human-like typing for URL
                await this.humanClick(page, urlInput);
                await this.humanDelay(500, 1000);
                await this.humanType(urlInput, urlToPost);
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
                        // Use human-like click for Next button
                        await this.humanClick(page, nextButton);
                        this.log('[EVENT] Clicked Next button with human-like behavior - waiting for comment field to become visible', 'info', true);

                        // Wait longer for next form elements to appear with human-like delay
                        await this.humanDelay(3000, 6000);
                    } else {
                        this.log('[WARNING] Could not find Next button with any selector', 'warning', true);
                    }

                } catch (nextError) {
                    this.log(`[WARNING] Error clicking Next button: ${nextError.message}`, 'warning', true);
                }

            } catch (bookmarkLinkError) {
                throw new Error(`Could not find or click Bookmark link: ${bookmarkLinkError.message}`);
            }

            // Step 8c: Clear auto-filled title and fill our own title with human-like behavior
            this.log('[EVENT] Clearing auto-filled title and filling our own with human-like behavior...', 'detail', false);
            try {
                const titleInput = page.locator('input#bookmark_item_title[name="title"]');
                await titleInput.waitFor({ state: 'visible', timeout: 10000 });

                // Human-like interaction with title field
                await this.humanClick(page, titleInput);
                await this.humanDelay(300, 600);

                // Clear the auto-filled title with human-like behavior
                await titleInput.selectText();
                await this.humanDelay(200, 400);
                await titleInput.press('Delete');
                await this.humanDelay(300, 600);

                // Fill with our own title
                let titleToUse = '';
                if (extractedContent.title && extractedContent.title !== 'Untitled') {
                    titleToUse = extractedContent.title;
                } else {
                    // Create a meaningful title from user's business info
                    titleToUse = `${userInfo.first_name || 'Business'} ${userInfo.business_categories ? userInfo.business_categories.join(' & ') : 'Resource'} - ${userInfo.company_website || 'Professional Services'}`;
                }

                // Use human-like typing for title
                await this.humanType(titleInput, titleToUse);
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

                // Use human-like typing for comment
                await this.humanClick(page, commentTextarea);
                await this.humanDelay(500, 1000);
                await this.humanType(commentTextarea, contentToPost);
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

                // Use human-like typing for tags
                await this.humanClick(page, tagsInput);
                await this.humanDelay(500, 1000);
                await this.humanType(tagsInput, tagsString);
                this.log(`[EVENT] Filled tags: ${tagsString}`, 'info', true);

            } catch (tagsError) {
                throw new Error(`Could not fill tags field: ${tagsError.message}`);
            }

            // Step 8e: Click the Post button with human-like behavior
            this.log('[EVENT] Submitting the bookmark post with human-like behavior...', 'detail', false);
            try {
                const postButton = page.locator('input.firstIBtn[type="submit"][value="Post"]');
                await postButton.waitFor({ state: 'visible', timeout: 10000 });

                this.log('[EVENT] Found Post button - submitting with human-like behavior...', 'info', true);

                // Add human-like behavior before final submission
                await this.humanScroll(page);
                await this.humanDelay(1000, 2000);

                // Use human-like click for post button
                await this.humanClick(page, postButton);

                // Wait for the page to load after submission with human-like delay
                await this.humanDelay(4000, 7000);

                this.log('[EVENT] Bookmark post submitted successfully!', 'success', true);

            } catch (postError) {
                throw new Error(`Could not submit post: ${postError.message}`);
            }

            // Step 9: Take screenshot before getting permalink
            this.log('[EVENT] Taking screenshot before permalink extraction...', 'detail', false);
            const beforePermalinkScreenshotPath = `screenshot_before_permalink_${this.requestId}.png`;
            await page.screenshot({ path: beforePermalinkScreenshotPath, fullPage: true });
            const beforePermalinkCloudinaryResult = await cloudinary.uploader.upload(beforePermalinkScreenshotPath);
            fs.unlinkSync(beforePermalinkScreenshotPath);
            this.log(`[DEBUG] Before permalink screenshot: ${beforePermalinkCloudinaryResult.secure_url}`, 'info', true);

            // Step 10: Get the permalink of the newly posted bookmark
            this.log('[EVENT] Getting permalink of the newly posted bookmark...', 'detail', false);
            let permalink = null;

            try {
                // Simple approach: Click "more" button, then click "Link to this item", then get URL
                this.log('[EVENT] Looking for the first "more" button to get permalink...', 'info', true);

                // Wait a moment for the page to fully load
                await this.humanDelay(2000, 3000);

                // Find the first "more" button (should be from the newly posted bookmark)
                const moreButton = page.locator('a.menuItem:has-text("more")').first();
                await moreButton.waitFor({ state: 'visible', timeout: 10000 });

                this.log('[EVENT] Found "more" button - clicking to open dropdown...', 'info', true);
                await this.humanClick(page, moreButton);
                await this.humanDelay(1500, 2500);

                // Find and click "Link to this item" in the dropdown
                const linkToItemButton = page.locator('a:has-text("Link to this item")').first();
                await linkToItemButton.waitFor({ state: 'visible', timeout: 5000 });

                this.log('[EVENT] Found "Link to this item" - clicking to navigate...', 'info', true);
                await this.humanClick(page, linkToItemButton);
                await this.humanDelay(3000, 5000);

                // Get the permalink from the current page URL after navigation
                permalink = page.url();
                this.log(`[EVENT] Successfully navigated to bookmark page: ${permalink}`, 'success', true);

                this.log(`[EVENT] Found permalink of newly posted bookmark: ${permalink}`, 'success', true);

            } catch (permalinkError) {
                this.log(`[WARNING] Could not get permalink: ${permalinkError.message}`, 'warning', true);

                // Strategy 2: Try alternative approach - look for bookmark by title or URL
                try {
                    this.log('[EVENT] Trying alternative permalink extraction method...', 'detail', false);

                    // Look for a bookmark link that contains our posted URL
                    const urlToPost = extractedContent.url || userInfo.company_website || userInfo.public_website_1 || 'https://example.com';
                    const bookmarkWithOurUrl = page.locator(`a[href*="${urlToPost.replace('https://', '').replace('http://', '')}"]`).first();

                    if (await bookmarkWithOurUrl.isVisible({ timeout: 5000 })) {
                        // Get the parent container and look for more button
                        const parentContainer = bookmarkWithOurUrl.locator('xpath=ancestor::*[contains(@class, "item") or contains(@class, "bookmark") or contains(@class, "post")]').first();
                        const moreButtonInParent = parentContainer.locator('a.menuItem:has-text("more"), a:has-text("more")').first();

                        if (await moreButtonInParent.isVisible({ timeout: 3000 })) {
                            await this.humanClick(page, moreButtonInParent);
                            await this.humanDelay(1500, 3000);

                            const linkToItemElement = page.locator('a:has-text("Link to this item")').first();

                            // Get href directly without waiting for visibility
                            permalink = await linkToItemElement.getAttribute('href');
                            if (permalink && !permalink.startsWith('http')) {
                                permalink = `https://groups.diigo.com${permalink}`;
                            }

                            this.log(`[EVENT] Found permalink using alternative method: ${permalink}`, 'success', true);
                        }
                    }
                } catch (alternativeError) {
                    this.log(`[DEBUG] Alternative permalink method also failed: ${alternativeError.message}`, 'detail', false);
                }

                // Take a debug screenshot to see what's available
                const permalinkDebugScreenshotPath = `screenshot_permalink_debug_${this.requestId}.png`;
                await page.screenshot({ path: permalinkDebugScreenshotPath, fullPage: true });
                const permalinkDebugCloudinaryResult = await cloudinary.uploader.upload(permalinkDebugScreenshotPath);
                fs.unlinkSync(permalinkDebugScreenshotPath);
                this.log(`[DEBUG] Permalink debug screenshot: ${permalinkDebugCloudinaryResult.secure_url}`, 'info', true);

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

export default DiigoBookmarkingAdapter;
