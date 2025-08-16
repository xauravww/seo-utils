// import { chromium } from 'patchright';
// import BaseAdapter from '../BaseAdapter.js';
// import cloudinary from 'cloudinary';
// import fs from 'fs';
// import https from 'https';

// class KahkahamAdapter extends BaseAdapter {
//     constructor(jobDetails) {
//         super(jobDetails);
//         this.baseUrl = "https://kahkaham.net";
//         this.loginUrl = "https://kahkaham.net/";
//         this.createBlogUrl = "https://kahkaham.net/create-blog/";

//         // Category mapping for Kahkaham
//         this.categoryMapping = {
//             'Business': '4', // Economics and Trade
//             'Finance': '4', // Economics and Trade
//             'Technology': '16', // Science and Technology
//             'Gaming': '8', // Gaming
//             'Health': '10', // Live Style
//             'Education': '5', // Education
//             'Travel': '18', // Travel and Events
//             'Lifestyle': '10', // Live Style
//             'News': '12', // News and Politics
//             'Entertainment': '6', // Entertainment
//             'Sports': '17', // Sport
//             'Cars': '2', // Cars and Vehicles
//             'Movies': '7', // Movies & Animation
//             'Animals': '14', // Pets and Animals
//             'Comedy': '3', // Comedy
//             'History': '9', // History and Facts
//             'Natural': '11', // Natural
//             'People': '13', // People and Nations
//             'Places': '15' // Places and Regions
//         };

//         // Image format configuration
//         this.supportedImageFormats = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
//         this.defaultImageFormat = 'png';
//         this.imageQualitySettings = {
//             png: { quality: 1.0, mimeType: 'image/png' },
//             jpg: { quality: 0.9, mimeType: 'image/jpeg' },
//             jpeg: { quality: 0.9, mimeType: 'image/jpeg' },
//             gif: { quality: 1.0, mimeType: 'image/gif' },
//             webp: { quality: 0.9, mimeType: 'image/webp' }
//         };
//     }

//     /**
//      * Clean description text and ensure minimum 32 characters
//      * @param {string} text - Raw description text
//      * @returns {string} - Cleaned description text
//      */
//     cleanDescriptionForKahkaham(text) {
//         if (!text || typeof text !== 'string') {
//             return 'This is an informative blog post sharing valuable insights and information for readers.';
//         }

//         // Remove URLs and markdown links
//         let cleaned = text.replace(/https?:\/\/[^\s]+/gi, '');
//         cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/gi, '$1');
//         cleaned = cleaned.replace(/[^\w\s.,!?;:()\-'"&]/gi, ' ');
//         cleaned = cleaned.replace(/\s+/g, ' ').trim();

//         // Ensure minimum 32 characters
//         if (cleaned.length < 32) {
//             cleaned += ' This blog post provides valuable information and insights for readers interested in the topic.';
//         }

//         return cleaned;
//     }

//     /**
//      * Convert markdown/text content to HTML
//      * @param {string} content - Raw content
//      * @returns {string} - HTML formatted content
//      */
//     convertToHtml(content) {
//         if (!content) return '<p>Content not available</p>';

//         // Basic markdown to HTML conversion
//         let html = content;

//         // Convert headers
//         html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
//         html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
//         html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

//         // Convert bold and italic
//         html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
//         html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

//         // Convert links
//         html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

//         // Convert line breaks to paragraphs
//         const paragraphs = html.split('\n\n').filter(p => p.trim());
//         html = paragraphs.map(p => {
//             if (p.trim().startsWith('<h') || p.trim().startsWith('<ul') || p.trim().startsWith('<ol')) {
//                 return p.trim();
//             }
//             return `<p>${p.trim()}</p>`;
//         }).join('\n');

//         // Convert bullet points
//         html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
//         html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

//         return html;
//     }

//     /**
//      * Use existing dummy image file instead of generating a new one
//      * @returns {Promise<string>} - Path to the dummy image file
//      */
//     async getDummyImage() {
//         const imagePath = 'seo-utils/dummy.png';
        
//         // Verify the file exists
//         try {
//             fs.accessSync(imagePath, fs.constants.F_OK);
//             this.log(`Using existing dummy image: ${imagePath}`, 'info', true);
//             return imagePath;
//         } catch (error) {
//             this.log(`Dummy image not found at ${imagePath}, falling back to generated image`, 'warning', true);
//             return await this.generateFallbackImage();
//         }
//     }

//     /**
//      * Generate fallback image if dummy.png is not available
//      * @returns {Promise<string>} - Path to generated fallback image
//      */
//     async generateFallbackImage() {
//         const imagePath = `${this.requestId}-kahkaham-fallback.png`;
        
//         // Create a simple fallback image
//         const canvas = document.createElement('canvas');
//         canvas.width = 800;
//         canvas.height = 600;
//         const ctx = canvas.getContext('2d');

//         // Create gradient background
//         const gradient = ctx.createLinearGradient(0, 0, 800, 600);
//         gradient.addColorStop(0, '#4a90e2');
//         gradient.addColorStop(1, '#7b68ee');
//         ctx.fillStyle = gradient;
//         ctx.fillRect(0, 0, 800, 600);

//         // Add text
//         ctx.fillStyle = 'white';
//         ctx.font = 'bold 48px Arial';
//         ctx.textAlign = 'center';
//         ctx.fillText('Blog Post', 400, 280);

//         const buffer = Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64');
//         fs.writeFileSync(imagePath, buffer);
//         return imagePath;
//     }

//     /**
//      * Determine category using LLM API
//      * @param {Object} contentData - Content data
//      * @returns {Promise<string>} - Category ID
//      */
//     async determineCategory(contentData) {
//         try {
//             const prompt = this.buildCategoryPrompt(contentData);

//             const response = await fetch('http://31.97.229.2:3009/v1/chat/completions', {
//                 method: 'POST',
//                 headers: {
//                     'Content-Type': 'application/json',
//                     'Authorization': 'Bearer no-key'
//                 },
//                 body: JSON.stringify({
//                     model: 'Meta-Llama-3.1-8B-Instruct.Q6_K.gguf',
//                     temperature: 0,
//                     max_tokens: 30,
//                     messages: [
//                         {
//                             role: 'system',
//                             content: 'You are a JSON-only generator. You must output ONLY a valid JSON array from this EXACT fixed list: ["Business", "Finance", "Technology", "Gaming", "Health", "Education", "Travel", "Lifestyle", "News", "Entertainment", "Sports", "Cars", "Movies", "Animals", "Comedy", "History", "Natural", "People", "Places"]. Example: ["Technology", "News"]. No explanations or additional text.'
//                         },
//                         {
//                             role: 'user',
//                             content: prompt
//                         }
//                     ]
//                 })
//             });

//             const data = await response.json();
//             let rawContent = data.choices[0].message.content;
//             rawContent = rawContent.replace(/<\|eot_id\|>/g, '').trim();

//             let categories = [];
//             try {
//                 if (rawContent.startsWith('[') && rawContent.includes(']')) {
//                     const jsonMatch = rawContent.match(/\[.*?\]/);
//                     if (jsonMatch) {
//                         categories = JSON.parse(jsonMatch[0]);
//                     }
//                 }
//             } catch (parseError) {
//                 this.log(`Failed to parse LLM response: ${parseError.message}`, 'warning', true);
//             }

//             // Get the first valid category or default to Technology
//             const primaryCategory = categories.length > 0 ? categories[0] : 'Technology';
//             const categoryId = this.categoryMapping[primaryCategory] || '16'; // Default to Science and Technology

//             this.log(`LLM determined category: ${primaryCategory} (ID: ${categoryId})`, 'info', true);
//             return categoryId;

//         } catch (error) {
//             this.log(`Failed to determine category: ${error.message}`, 'error', true);
//             return '16'; // Default to Science and Technology
//         }
//     }

//     /**
//      * Build prompt for LLM category determination
//      * @param {Object} contentData - Content data
//      * @returns {string} - Formatted prompt
//      */
//     buildCategoryPrompt(contentData) {
//         const reqBody = this.job?.data?.reqBody || this.job?.data || {};
//         const userInfo = reqBody?.info?.user || {};
//         const businessInfo = reqBody?.info || {};

//         let prompt = 'Categorize this content: ';

//         if (this.content.title) {
//             prompt += `Title: "${this.content.title}". `;
//         }

//         if (this.content.body || this.content.markdown) {
//             const content = this.content.body || this.content.markdown;
//             prompt += `Content: "${content.substring(0, 300)}...". `;
//         }

//         if (userInfo.business_categories && userInfo.business_categories.length > 0) {
//             prompt += `Business categories: ${userInfo.business_categories.join(', ')}. `;
//         }

//         return prompt;
//     }

//     /**
//      * Generate relevant tags based on content and business info
//      * @returns {string[]} - Array of tags
//      */
//     generateTags() {
//         const tags = [];
//         const reqBody = this.job?.data?.reqBody || this.job?.data || {};
//         const userInfo = reqBody?.info?.user || {};

//         // Add business category tags
//         if (userInfo.business_categories && userInfo.business_categories.length > 0) {
//             tags.push(...userInfo.business_categories.map(cat => cat.toLowerCase()));
//         }

//         // Add content-based tags
//         if (this.content.title) {
//             const titleWords = this.content.title.toLowerCase()
//                 .split(' ')
//                 .filter(word => word.length > 3 && !['this', 'that', 'with', 'from', 'they', 'have', 'been', 'will', 'your', 'what', 'when', 'where', 'how'].includes(word))
//                 .slice(0, 3);
//             tags.push(...titleWords);
//         }

//         // Add default relevant tags
//         const defaultTags = ['blog', 'article', 'information', 'insights'];
//         tags.push(...defaultTags);

//         // Remove duplicates and limit to 8 tags
//         const uniqueTags = [...new Set(tags)].slice(0, 8);

//         return uniqueTags;
//     }

//     async publish() {
//         let browser, page;

//         try {
//             this.log('Starting Kahkaham publication', 'info', true);

//             // Launch browser
//             browser = await chromium.launch({
//                 headless: false,
//                 args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
//             });
//             page = await browser.newPage();

//             // Extract credentials and content
//             let username, password, title, content, description;

//             try {
//                 // Extract credentials from website object
//                 if (this.website && this.website.credentials) {
//                     username = this.website.credentials.username;
//                     password = this.website.credentials.password;
//                 } else {
//                     throw new Error('No website credentials found');
//                 }

//                 if (!username || !password) {
//                     throw new Error('Username and password are required for Kahkaham login');
//                 }

//                 // Extract content
//                 title = this.content.title || 'Untitled Blog Post';
//                 content = this.content.body || this.content.html || this.content.markdown || '';

//                 // Clean and ensure description meets requirements
//                 const rawDescription = this.content.description || content.substring(0, 200);
//                 description = this.cleanDescriptionForKahkaham(rawDescription);

//                 this.log(`Extracted data: username=${username}, title="${title}"`, 'detail', false);
//                 this.log(`Description (${description.length} chars): ${description.substring(0, 100)}...`, 'detail', false);

//             } catch (extractError) {
//                 throw new Error(`Failed to extract data: ${extractError.message}`);
//             }

//             // Step 1: Navigate to login page and login
//             this.log('Navigating to Kahkaham login page', 'detail', false);

//             await page.goto(this.loginUrl, {
//                 waitUntil: 'networkidle',
//                 timeout: 30000
//             });

//             // Wait for login form and fill credentials
//             await page.waitForSelector('#login', { timeout: 10000 });
//             await page.fill('#username', username);
//             await page.fill('#password', password);

//             this.log('Credentials filled, submitting login form', 'detail', false);
//             await page.click('button[type="submit"]');
//             await page.waitForLoadState('networkidle');
//             await page.waitForTimeout(3000);

//             // Verify login was successful
//             const currentUrl = page.url();
//             this.log(`Current URL after login: ${currentUrl}`, 'detail', false);

//             // Check if we're still on login page (login failed)
//             if (currentUrl.includes('login') || currentUrl === this.loginUrl) {
//                 throw new Error('Login appears to have failed - still on login page');
//             }

//             this.log('Login completed successfully', 'info', true);

//             // Step 2: Navigate to create blog page with enhanced debugging
//             this.log('Navigating to create blog page', 'detail', false);

//             // Wait a bit more after login to ensure session is established
//             await page.waitForTimeout(2000);

//             let navigationSuccessful = false;

//             try {
//                 // First try direct navigation with better error handling
//                 this.log(`Attempting direct navigation to: ${this.createBlogUrl}`, 'detail', false);

//                 const response = await page.goto(this.createBlogUrl, {
//                     waitUntil: 'domcontentloaded',
//                     timeout: 20000
//                 });

//                 // Check if navigation was successful
//                 const finalUrl = page.url();
//                 this.log(`Navigation response status: ${response?.status()}, Final URL: ${finalUrl}`, 'detail', false);

//                 if (finalUrl.includes('create-blog') || finalUrl.includes('create_blog')) {
//                     this.log('Direct navigation to create-blog successful', 'info', true);
//                     navigationSuccessful = true;
//                 } else {
//                     throw new Error(`Navigation redirected to unexpected URL: ${finalUrl}`);
//                 }

//             } catch (directNavError) {
//                 this.log(`Direct navigation failed: ${directNavError.message}`, 'warning', true);

//                 // Try alternative approach - look for create blog link on current page
//                 try {
//                     this.log('Trying to find create blog link on current page', 'detail', false);

//                     // Take screenshot to see current page
//                     const debugScreenshotPath = `${this.requestId}-debug-before-create-blog.png`;
//                     await page.screenshot({ path: debugScreenshotPath, fullPage: true });
//                     this.log(`Debug screenshot taken: ${debugScreenshotPath}`, 'detail', false);

//                     // Common selectors for create blog links
//                     const createBlogSelectors = [
//                         'a[href*="create-blog"]',
//                         'a[href*="create_blog"]',
//                         'a[href*="new-blog"]',
//                         'a[href*="add-blog"]',
//                         'text="Create Blog"',
//                         'text="New Blog"',
//                         'text="Add Blog"',
//                         'text="Write Blog"',
//                         'text="Create"',
//                         'text="Write"'
//                     ];

//                     let linkFound = false;
//                     for (const selector of createBlogSelectors) {
//                         try {
//                             const link = await page.$(selector);
//                             if (link) {
//                                 this.log(`Found create blog link with selector: ${selector}`, 'detail', false);
//                                 await page.click(selector);
//                                 await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

//                                 const newUrl = page.url();
//                                 this.log(`After clicking link, new URL: ${newUrl}`, 'detail', false);

//                                 if (newUrl.includes('create-blog') || newUrl.includes('create_blog')) {
//                                     linkFound = true;
//                                     navigationSuccessful = true;
//                                     break;
//                                 }
//                             }
//                         } catch (linkError) {
//                             this.log(`Link selector ${selector} failed: ${linkError.message}`, 'detail', false);
//                             continue;
//                         }
//                     }

//                     if (!linkFound) {
//                         // Try going to homepage first, then create blog
//                         this.log('No create blog link found, trying homepage first', 'detail', false);
//                         await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
//                         await page.waitForTimeout(2000);

//                         // Try create blog URL again from homepage
//                         const homepageResponse = await page.goto(this.createBlogUrl, {
//                             waitUntil: 'domcontentloaded',
//                             timeout: 15000
//                         });

//                         const homepageUrl = page.url();
//                         this.log(`Homepage approach - Final URL: ${homepageUrl}`, 'detail', false);

//                         if (homepageUrl.includes('create-blog') || homepageUrl.includes('create_blog')) {
//                             navigationSuccessful = true;
//                         }
//                     }
//                 } catch (altNavError) {
//                     this.log(`Alternative navigation failed: ${altNavError.message}`, 'error', true);
//                 }
//             }

//             if (!navigationSuccessful) {
//                 const currentUrl = page.url();
//                 throw new Error(`Failed to navigate to create-blog page. Current URL: ${currentUrl}. Please check if the URL is correct or if additional authentication is required.`);
//             }

//             this.log('Successfully navigated to create blog page', 'info', true);

//             // Step 3: Fill blog title and description with scrolling
//             await page.waitForSelector('#blog_title', { timeout: 10000 });

//             // Scroll to title field and fill
//             await page.locator('#blog_title').scrollIntoViewIfNeeded();
//             await page.fill('#blog_title', title);

//             // Scroll to description field and fill
//             await page.locator('#new-blog-desc').scrollIntoViewIfNeeded();
//             await page.fill('#new-blog-desc', description);

//             this.log('Title and description filled', 'detail', false);

//             // Step 4: Determine and select category with scrolling
//             const categoryId = await this.determineCategory(this.content);
//             await page.locator('#blog_category').scrollIntoViewIfNeeded();
//             await page.selectOption('#blog_category', categoryId);

//             this.log(`Category selected: ${categoryId}`, 'detail', false);

//             // Step 5: Open source code editor
//             this.log('Opening source code editor', 'detail', false);

//             // Try multiple selectors for the Tools button with more comprehensive approach
//             const toolsButtonSelectors = [
//                 'button:has-text("Tools")',
//                 '.mce-btn:has-text("Tools")',
//                 '[title="Tools"]',
//                 '.mce-menubtn:has-text("Tools")',
//                 'button[aria-label*="Tools"]',
//                 '.mce-widget:has-text("Tools")',
//                 '.mce-toolbar button:has-text("Tools")',
//                 '.mce-toolbar .mce-btn:has-text("Tools")',
//                 'button[title*="Tools"]',
//                 '.mce-container button:has-text("Tools")',
//                 // Try by looking for any button with "Tools" text
//                 'button:contains("Tools")',
//                 '.mce-btn:contains("Tools")'
//             ];

//             let toolsButtonFound = false;

//             // First, wait for TinyMCE to fully load
//             await page.waitForTimeout(2000);

//             // Take a screenshot to see the current state
//             const debugToolsPath = `${this.requestId}-debug-tools-search.png`;
//             await page.screenshot({ path: debugToolsPath, fullPage: true });
//             this.log(`Debug screenshot for Tools button search: ${debugToolsPath}`, 'detail', false);

//             for (const selector of toolsButtonSelectors) {
//                 try {
//                     const toolsButton = await page.$(selector);
//                     if (toolsButton) {
//                         this.log(`Found Tools button with selector: ${selector}`, 'detail', false);
//                         await page.click(selector);
//                         await page.waitForTimeout(1000);
//                         toolsButtonFound = true;
//                         break;
//                     }
//                 } catch (toolsError) {
//                     this.log(`Tools selector ${selector} failed: ${toolsError.message}`, 'detail', false);
//                     continue;
//                 }
//             }

//             if (!toolsButtonFound) {
//                 // Try alternative approach - look for any TinyMCE menu button
//                 this.log('Tools button not found, trying alternative TinyMCE approach', 'warning', true);

//                 try {
//                     // Look for any dropdown or menu button in TinyMCE
//                     const alternativeSelectors = [
//                         '.mce-menubtn',
//                         '.mce-btn[aria-haspopup="true"]',
//                         '.mce-toolbar button[aria-haspopup="true"]',
//                         '.mce-container [role="button"]'
//                     ];

//                     for (const altSelector of alternativeSelectors) {
//                         const altButton = await page.$(altSelector);
//                         if (altButton) {
//                             this.log(`Trying alternative TinyMCE button: ${altSelector}`, 'detail', false);
//                             await page.click(altSelector);
//                             await page.waitForTimeout(1000);

//                             // Check if a menu appeared with Source code option
//                             const sourceCodeCheck = await page.$('text="Source code"');
//                             if (sourceCodeCheck) {
//                                 this.log('Found Source code option after clicking alternative button', 'detail', false);
//                                 toolsButtonFound = true;
//                                 break;
//                             }
//                         }
//                     }
//                 } catch (altError) {
//                     this.log(`Alternative TinyMCE approach failed: ${altError.message}`, 'warning', true);
//                 }
//             }

//             if (!toolsButtonFound) {
//                 throw new Error('Tools button not found with any selector - TinyMCE may not be loaded or have different structure');
//             }

//             // Try multiple selectors for Source code option
//             const sourceCodeSelectors = [
//                 'text="Source code"',
//                 '.mce-menu-item:has-text("Source code")',
//                 '[title="Source code"]',
//                 '.mce-text:has-text("Source code")'
//             ];

//             let sourceCodeFound = false;
//             for (const selector of sourceCodeSelectors) {
//                 try {
//                     const sourceCodeOption = await page.$(selector);
//                     if (sourceCodeOption) {
//                         this.log(`Found Source code option with selector: ${selector}`, 'detail', false);
//                         await page.click(selector);
//                         await page.waitForTimeout(1000);
//                         sourceCodeFound = true;
//                         break;
//                     }
//                 } catch (sourceError) {
//                     continue;
//                 }
//             }

//             if (!sourceCodeFound) {
//                 throw new Error('Source code option not found with any selector');
//             }

//             // Step 6: Fill HTML content
//             const htmlContent = this.convertToHtml(content);
//             // Use a more generic selector for the textarea
//             await page.waitForSelector('textarea.mce-textbox', { timeout: 5000 });
//             await page.fill('textarea.mce-textbox', htmlContent);

//             this.log('HTML content filled in source editor', 'detail', false);

//             // Click OK to close source editor - use text-based selector
//             await page.click('button:has-text("Ok")');
//             await page.waitForTimeout(1000);

//             // Step 7: Add tags by making hidden input visible and filling it
//             this.log('Adding tags', 'detail', false);
//             let tagsSuccessful = false;

//             // Generate tags based on content and business info
//             const tags = this.generateTags();
//             console.log("Tags to add:", tags);

//             if (tags.length > 0) {
//                 try {
//                     // First scroll to the tags container (not the hidden input itself)
//                     await page.locator('label[for="blog_tags"]').scrollIntoViewIfNeeded();
//                     await page.waitForTimeout(1000);

//                     // Make the hidden input visible and accessible
//                     await page.evaluate(() => {
//                         const hiddenInput = document.querySelector('#blog_tags');
//                         if (hiddenInput) {
//                             hiddenInput.style.display = 'block';
//                             hiddenInput.style.visibility = 'visible';
//                             hiddenInput.style.opacity = '1';
//                             hiddenInput.style.position = 'static';
//                             hiddenInput.style.width = 'auto';
//                             hiddenInput.style.height = 'auto';
//                         }
//                     });

//                     this.log('Made hidden tags input visible and accessible', 'detail', false);

//                     // Add all tags as a comma-separated string to the hidden input
//                     const tagsString = tags.join(',');

//                     // Fill the hidden input directly
//                     await page.fill('#blog_tags', tagsString);
//                     await page.waitForTimeout(500);

//                     // Trigger multiple events to ensure bootstrap-tagsinput recognizes the change
//                     await page.evaluate((value) => {
//                         const hiddenInput = document.querySelector('#blog_tags');
//                         if (hiddenInput) {
//                             hiddenInput.value = value;
//                             hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
//                             hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
//                             hiddenInput.dispatchEvent(new Event('keyup', { bubbles: true }));
//                         }
//                     }, tagsString);

//                     this.log(`Successfully added tags to hidden input: ${tagsString}`, 'info', true);
//                     tagsSuccessful = true;
//                 } catch (tagError) {
//                     this.log(`Warning: Could not add tags: ${tagError.message}`, 'warning', true);
//                 }
//             }

//             // Track if tags were successful for final validation
//             const tagsStatus = tagsSuccessful ? 'successful' : 'failed';

//             // Step 8: Generate and upload image (optional - won't fail if not found)
//             this.log('Attempting image upload', 'detail', false);
//             let imageUploadSuccessful = false;

//             try {
//                 const imagePath = await this.generateDummyImage(page);

//                 // Try to find file input without scrolling
//                 const fileInput = await page.$('#thumbnail');
//                 if (fileInput) {
//                     this.log('Found thumbnail input, proceeding with upload', 'detail', false);

//                     // Set the file on the input element
//                     await fileInput.setInputFiles(imagePath);
//                     this.log('File set on input, triggering upload process', 'detail', false);

//                     // Trigger change event to start upload process
//                     await page.evaluate(() => {
//                         const input = document.querySelector('#thumbnail');
//                         if (input && input.files && input.files.length > 0) {
//                             input.dispatchEvent(new Event('change', { bubbles: true }));
//                             input.dispatchEvent(new Event('input', { bubbles: true }));
//                         }
//                     });

//                     // Wait for image to be processed and preview to appear
//                     this.log('Waiting for image processing and preview...', 'detail', false);

//                     let uploadAttempts = 0;
//                     const maxAttempts = 15;

//                     while (uploadAttempts < maxAttempts) {
//                         await page.waitForTimeout(1000);
//                         uploadAttempts++;

//                         // Check if the image preview has changed from the default
//                         const imageProcessed = await page.evaluate(() => {
//                             const previewArea = document.querySelector('.upload_ad_image');
//                             const uploadText = previewArea ? previewArea.textContent : '';

//                             // Check if preview text has changed from default
//                             const hasDefaultText = uploadText.includes('Drop Image Here') || uploadText.includes('Browse To Upload');

//                             // Check if there's an actual image preview
//                             const hasImagePreview = document.querySelector('img[src*="blob:"], img[src*="data:"], img[src*="upload"], .image-preview img');

//                             return {
//                                 hasDefaultText,
//                                 hasImagePreview: !!hasImagePreview,
//                                 previewText: uploadText.substring(0, 50)
//                             };
//                         });

//                         this.log(`Upload check ${uploadAttempts}: hasDefaultText=${imageProcessed.hasDefaultText}, hasImagePreview=${imageProcessed.hasImagePreview}`, 'detail', false);

//                         // Success if we have an image preview or the default text is gone
//                         if (imageProcessed.hasImagePreview || !imageProcessed.hasDefaultText) {
//                             this.log('Image processing completed - preview detected', 'info', true);
//                             imageUploadSuccessful = true;
//                             break;
//                         }
//                     }

//                     if (!imageUploadSuccessful) {
//                         // Take a screenshot to see current state
//                         const debugImagePath = `${this.requestId}-debug-image-upload.png`;
//                         await page.screenshot({ path: debugImagePath, fullPage: true });
//                         this.log(`Debug screenshot for image upload: ${debugImagePath}`, 'detail', false);

//                         throw new Error('Image upload failed - no preview detected after processing');
//                     }
//                 } else {
//                     this.log('Thumbnail input not found, skipping image upload', 'warning', true);
//                 }

//                 // Clean up generated image
//                 try {
//                     fs.unlinkSync(imagePath);
//                 } catch (cleanupError) {
//                     this.log(`Warning: Could not clean up image file: ${cleanupError.message}`, 'warning', true);
//                 }
//             } catch (imageError) {
//                 this.log(`Image upload failed: ${imageError.message}`, 'error', true);
//                 throw new Error('Image upload failed - image is required for blog post submission');
//             }

//             // Step 9: Submit the blog post
//             this.log('Submitting blog post', 'detail', false);

//             // Use the specific publish button selector you provided
//             await page.click('button.btn.btn-main.btn-mat.btn-mat-raised.add_wow_loader[type="submit"]');
//             await page.waitForLoadState('networkidle', { timeout: 30000 });

//             // Take screenshot
//             let screenshotUrl = null;
//             try {
//                 const screenshotPath = `${this.requestId}-kahkaham-screenshot.png`;
//                 await page.screenshot({ path: screenshotPath, fullPage: true });

//                 const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
//                 fs.unlinkSync(screenshotPath);
//                 screenshotUrl = cloudinaryResult.secure_url;
//                 this.logScreenshotUploaded(screenshotUrl);
//             } catch (screenshotError) {
//                 this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
//             }

//             // Get final URL
//             const finalUrl = page.url();

//             // Validate overall success based on all steps
//             if (tagsSuccessful) {
//                 this.log('Blog post submitted successfully with all features', 'info', true);
//                 this.logPublicationSuccess(finalUrl);
//                 return {
//                     success: true,
//                     postUrl: finalUrl,
//                     screenshotUrl: screenshotUrl
//                 };
//             } else {
//                 this.log('Blog post submitted but tags failed - partial success', 'warning', true);
//                 return {
//                     success: false,
//                     error: 'Blog post submitted but tags could not be added',
//                     postUrl: finalUrl,
//                     screenshotUrl: screenshotUrl
//                 };
//             }

//         } catch (error) {
//             this.log(`Kahkaham publication failed: ${error.message}`, 'error', true);

//             // Take error screenshot if possible
//             if (page) {
//                 try {
//                     const errorScreenshotPath = `${this.requestId}-kahkaham-error.png`;
//                     await page.screenshot({ path: errorScreenshotPath, fullPage: true });
//                     const errorCloudinaryResult = await cloudinary.uploader.upload(errorScreenshotPath);
//                     fs.unlinkSync(errorScreenshotPath);
//                     this.logErrorScreenshotUploaded(errorCloudinaryResult.secure_url);
//                 } catch (screenshotError) {
//                     this.log(`Could not take error screenshot: ${screenshotError.message}`, 'warning', true);
//                 }
//             }

//             return {
//                 success: false,
//                 error: error.message,
//                 postUrl: null,
//                 screenshotUrl: null
//             };
//         } finally {
//             if (browser) {
//                 try {
//                     // Don't close browser for debugging as requested
//                     // await browser.close();
//                     this.log('Browser left open for debugging', 'info', true);
//                 } catch (closeError) {
//                     this.log(`Warning: Could not close browser: ${closeError.message}`, 'warning', true);
//                 }
//             }
//         }
//     }
// }

// export default KahkahamAdapter;  




import { chromium } from 'patchright';
import BaseAdapter from '../BaseAdapter.js';
import cloudinary from 'cloudinary';
import fs from 'fs';
import https from 'https';

class KahkahamAdapter extends BaseAdapter {
    constructor(jobDetails) {
        super(jobDetails);
        this.baseUrl = "https://kahkaham.net";
        this.loginUrl = "https://kahkaham.net/";
        this.createBlogUrl = "https://kahkaham.net/create-blog/";

        // Category mapping for Kahkaham
        this.categoryMapping = {
            'Business': '4',
            'Finance': '4',
            'Technology': '16',
            'Gaming': '8',
            'Health': '10',
            'Education': '5',
            'Travel': '18',
            'Lifestyle': '10',
            'News': '12',
            'Entertainment': '6',
            'Sports': '17',
            'Cars': '2',
            'Movies': '7',
            'Animals': '14',
            'Comedy': '3',
            'History': '9',
            'Natural': '11',
            'People': '13',
            'Places': '15'
        };
    }

    /**
     * Clean description text and ensure minimum 32 characters
     * @param {string} text - Raw description text
     * @returns {string} - Cleaned description text
     */
    cleanDescriptionForKahkaham(text) {
        if (!text || typeof text !== 'string') {
            return 'This is an informative blog post sharing valuable insights and information for readers.';
        }

        let cleaned = text.replace(/https?:\/\/[^\s]+/gi, '');
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/gi, '$1');
        cleaned = cleaned.replace(/[^\w\s.,!?;:()\-'"&]/gi, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        if (cleaned.length < 32) {
            cleaned += ' This blog post provides valuable information and insights for readers interested in the topic.';
        }

        return cleaned;
    }

    /**
     * Convert markdown/text content to HTML
     * @param {string} content - Raw content
     * @returns {string} - HTML formatted content
     */
    convertToHtml(content) {
        if (!content) return '<p>Content not available</p>';

        let html = content;
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

        const paragraphs = html.split('\n\n').filter(p => p.trim());
        html = paragraphs.map(p => {
            if (p.trim().startsWith('<h') || p.trim().startsWith('<ul') || p.trim().startsWith('<ol')) {
                return p.trim();
            }
            return `<p>${p.trim()}</p>`;
        }).join('\n');

        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

        return html;
    }

    /**
     * Use the dummy.png file from the project root.
     * @returns {Promise<string>} - Path to the dummy image file.
     */
    async getDummyImage() {
        const imagePath = 'dummy.png';
        
        try {
            fs.accessSync(imagePath, fs.constants.F_OK);
            this.log(`Using existing dummy image: ${imagePath}`, 'info', true);
            return imagePath;
        } catch (error) {
            this.log(`Required dummy image not found at ${imagePath}`, 'error', true);
            throw new Error(`The file 'dummy.png' is required but was not found in the project root.`);
        }
    }

    /**
     * Determine category using LLM API
     * @param {Object} contentData - Content data
     * @returns {Promise<string>} - Category ID
     */
    async determineCategory(contentData) {
        try {
            const prompt = this.buildCategoryPrompt(contentData);

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
                        { role: 'system', content: 'You are a JSON-only generator. You must output ONLY a valid JSON array from this EXACT fixed list: ["Business", "Finance", "Technology", "Gaming", "Health", "Education", "Travel", "Lifestyle", "News", "Entertainment", "Sports", "Cars", "Movies", "Animals", "Comedy", "History", "Natural", "People", "Places"]. Example: ["Technology", "News"]. No explanations or additional text.' },
                        { role: 'user', content: prompt }
                    ]
                })
            });

            const data = await response.json();
            let rawContent = data.choices[0].message.content;
            rawContent = rawContent.replace(/<\|eot_id\|>/g, '').trim();

            let categories = [];
            try {
                if (rawContent.startsWith('[') && rawContent.includes(']')) {
                    const jsonMatch = rawContent.match(/\[.*?\]/);
                    if (jsonMatch) {
                        categories = JSON.parse(jsonMatch[0]);
                    }
                }
            } catch (parseError) {
                this.log(`Failed to parse LLM response: ${parseError.message}`, 'warning', true);
            }

            const primaryCategory = categories.length > 0 ? categories[0] : 'Technology';
            const categoryId = this.categoryMapping[primaryCategory] || '16';

            this.log(`LLM determined category: ${primaryCategory} (ID: ${categoryId})`, 'info', true);
            return categoryId;

        } catch (error) {
            this.log(`Failed to determine category: ${error.message}`, 'error', true);
            return '16';
        }
    }

    /**
     * Build prompt for LLM category determination
     * @param {Object} contentData - Content data
     * @returns {string} - Formatted prompt
     */
    buildCategoryPrompt(contentData) {
        const reqBody = this.job?.data?.reqBody || this.job?.data || {};
        const userInfo = reqBody?.info?.user || {};
        const businessInfo = reqBody?.info || {};

        let prompt = 'Categorize this content: ';
        if (this.content.title) prompt += `Title: "${this.content.title}". `;
        if (this.content.body || this.content.markdown) {
            const content = this.content.body || this.content.markdown;
            prompt += `Content: "${content.substring(0, 300)}...". `;
        }
        if (userInfo.business_categories && userInfo.business_categories.length > 0) {
            prompt += `Business categories: ${userInfo.business_categories.join(', ')}. `;
        }

        return prompt;
    }

    /**
     * Generate relevant tags based on content and business info
     * @returns {string[]} - Array of tags
     */
    generateTags() {
        const tags = [];
        const reqBody = this.job?.data?.reqBody || this.job?.data || {};
        const userInfo = reqBody?.info?.user || {};

        if (userInfo.business_categories && userInfo.business_categories.length > 0) {
            tags.push(...userInfo.business_categories.map(cat => cat.toLowerCase()));
        }

        if (this.content.title) {
            const titleWords = this.content.title.toLowerCase()
                .split(' ')
                .filter(word => word.length > 3 && !['this', 'that', 'with', 'from', 'they', 'have', 'been', 'will', 'your', 'what', 'when', 'where', 'how'].includes(word))
                .slice(0, 3);
            tags.push(...titleWords);
        }

        const defaultTags = ['blog', 'article', 'information', 'insights'];
        tags.push(...defaultTags);

        return [...new Set(tags)].slice(0, 8);
    }

    async publish() {
        let browser, page;

        try {
            this.log('Starting Kahkaham publication', 'info', true);

            browser = await chromium.launch({
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
            });
            page = await browser.newPage();

            let username, password, title, content, description;
            try {
                if (!this.website || !this.website.credentials || !this.website.credentials.username || !this.website.credentials.password) {
                    throw new Error('Username and password are required for Kahkaham login');
                }
                username = this.website.credentials.username;
                password = this.website.credentials.password;

                title = this.content.title || 'Untitled Blog Post';
                content = this.content.body || this.content.html || this.content.markdown || '';
                const rawDescription = this.content.description || content.substring(0, 200);
                description = this.cleanDescriptionForKahkaham(rawDescription);
            } catch (extractError) {
                throw new Error(`Failed to extract data: ${extractError.message}`);
            }

            // Step 1: Login
            await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForSelector('#login', { timeout: 10000 });
            await page.fill('#username', username);
            await page.fill('#password', password);
            await page.click('button[type="submit"]');
            await page.waitForLoadState('networkidle');
            
            if (page.url().includes('login')) {
                throw new Error('Login failed - still on login page');
            }
            this.log('Login successful', 'info', true);
            
            // Step 2: Navigate to create blog page
            await page.goto(this.createBlogUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            if (!page.url().includes('create-blog')) {
                 throw new Error(`Failed to navigate to create-blog page. Current URL: ${page.url()}`);
            }
            this.log('Successfully on create blog page', 'info', true);

            // Step 3: Fill blog details
            await page.waitForSelector('#blog_title', { timeout: 10000 });
            await page.fill('#blog_title', title);
            await page.fill('#new-blog-desc', description);
            
            // Step 4: Select category
            const categoryId = await this.determineCategory(this.content);
            await page.selectOption('#blog_category', categoryId);

            // Step 5 & 6: Fill HTML content
            await page.click('button:has-text("Tools")');
            await page.click('text="Source code"');
            await page.waitForSelector('textarea.mce-textbox', { timeout: 5000 });
            const htmlContent = this.convertToHtml(content);
            await page.fill('textarea.mce-textbox', htmlContent);
            await page.click('button:has-text("Ok")');
            
            // Step 7: Add tags
            const tags = this.generateTags();
            if (tags.length > 0) {
                 await page.evaluate(() => {
                    const hiddenInput = document.querySelector('#blog_tags');
                    if (hiddenInput) {
                        hiddenInput.style.display = 'block';
                        hiddenInput.style.visibility = 'visible';
                    }
                });
                await page.fill('#blog_tags', tags.join(','));
                this.log(`Added tags: ${tags.join(',')}`, 'info', true);
            }

            // Step 8: Upload image
            try {
                const imagePath = await this.getDummyImage();
                const fileInput = await page.$('#thumbnail');
                if (fileInput) {
                    // Just set the file on the input. The site uploads it on final submission.
                    await fileInput.setInputFiles(imagePath);
                    this.log('Image file selected for upload', 'info', true);
                } else {
                    this.log('Thumbnail input not found, skipping image upload', 'warning', true);
                }
            } catch (imageError) {
                this.log(`Image handling failed: ${imageError.message}`, 'error', true);
                throw new Error('Image selection failed, which is required for submission.');
            }
            
            // Step 9: Submit the blog post
            this.log('Submitting blog post', 'detail', false);

            const publishButton = page.getByRole('button', { name: 'Publish' });
            await publishButton.waitFor({ state: 'visible', timeout: 10000 });
            await publishButton.scrollIntoViewIfNeeded();
            await publishButton.click();

            await page.waitForLoadState('networkidle', { timeout: 30000 });
            
            // Finalization
            const finalUrl = page.url();
            let screenshotUrl = null;
            try {
                const screenshotPath = `${this.requestId}-kahkaham-screenshot.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                const cloudinaryResult = await cloudinary.uploader.upload(screenshotPath);
                fs.unlinkSync(screenshotPath);
                screenshotUrl = cloudinaryResult.secure_url;
                this.logScreenshotUploaded(screenshotUrl);
            } catch (screenshotError) {
                this.log(`Warning: Could not take screenshot: ${screenshotError.message}`, 'warning', true);
            }

            this.log('Blog post submitted successfully', 'info', true);
            this.logPublicationSuccess(finalUrl);
            return {
                success: true,
                postUrl: finalUrl,
                screenshotUrl: screenshotUrl
            };

        } catch (error) {
            this.log(`Kahkaham publication failed: ${error.message}`, 'error', true);
            if (page) {
                try {
                    const errorScreenshotPath = `${this.requestId}-kahkaham-error.png`;
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
                // await browser.close(); 
                this.log('Browser left open for debugging', 'info', true);
            }
        }
    }
}

export default KahkahamAdapter;