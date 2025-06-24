import { chromium } from 'playwright';

export const postToCityData = async (req, res) => {
    const { username, password, subject, body } = req.body;

    if (!username || !password || !subject || !body) {
        return res.status(400).json({ error: 'Missing required fields: username, password, subject, body' });
    }

    let browser;
    try {
        console.log('[EVENT] Launching browser...');
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        //====================================================================
        // OPTIMIZATION: Block unnecessary resources
        //====================================================================
        // Not blocking images/css as per user constraints and functionality requirements
        await page.route('**/*google-analytics.com*', (route) => route.abort());
        await page.route('**/*doubleclick.net*', (route) => route.abort());
        await page.route('**/*twitter.com*', (route) => route.abort());

        //====================================================================
        // AUTOMATION SCRIPT LOGIC
        //====================================================================
        // --- STEP 1: LOGIN ---
        console.log('[EVENT] Navigating to the login page...');
        await page.goto('https://www.city-data.com/forum/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Login page navigation complete.');

        console.log('[EVENT] Locating username field...');
        const usernameField = page.locator('#navbar_username');
        await usernameField.waitFor({ state: 'visible', timeout: 10000 });
        console.log('[EVENT] Filling username field...');
        await usernameField.fill(username);
        console.log('[EVENT] Username field filled.');

        console.log('[EVENT] Locating password field...');
        const passwordField = page.locator('#navbar_password');
        await passwordField.waitFor({ state: 'visible', timeout: 10000 });
        console.log('[EVENT] Filling password field...');
        await passwordField.fill(password);
        console.log('[EVENT] Password field filled.');

        console.log('[EVENT] Locating login button...');
        const loginButton = page.locator('td.alt2 input[type="submit"]');
        await loginButton.waitFor({ state: 'visible', timeout: 10000 });
        console.log('[EVENT] Clicking login button and waiting for navigation...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
            loginButton.click()
        ]);
        console.log('[EVENT] Login button clicked and navigation complete.');
        console.log('[SUCCESS] Login appears successful.');

        // --- STEP 2: NAVIGATE TO FORUM ---
        console.log('[EVENT] Navigating to the target forum page...');
        await page.goto('https://www.city-data.com/forum/world/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Forum page navigation complete.');

        // --- STEP 3: CLICK "NEW THREAD" BUTTON ---
        console.log('[EVENT] Locating "New Thread" button...');
        const newThreadButton = page.getByAltText('Post New Thread').first();
        await newThreadButton.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking "New Thread" button...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
            newThreadButton.click({ timeout: 10000 })
        ]);
        console.log('[EVENT] "New Thread" button clicked successfully.');

        // --- STEP 4: CHECK FOR RATE LIMITING AND FILL FORM ---
        const subjectInputLocator = page.locator('#inputthreadtitle');
        const rateLimitLocator = page.locator('div.panel:has-text("You have reached the maximum number of threads")');

        try {
            await Promise.race([
                subjectInputLocator.waitFor({ state: 'visible', timeout: 30000 }),
                rateLimitLocator.waitFor({ state: 'visible', timeout: 30000 })
            ]);
        } catch (e) {
            throw new Error('Neither the new thread form nor a rate limit message appeared.');
        }

        if (await rateLimitLocator.isVisible()) {
            const errorMessage = await rateLimitLocator.innerText();
            throw new Error(`Rate limit reached: ${errorMessage.trim()}`);
        }

        console.log('[EVENT] Locating discussion subject field...');
        const subjectInput = subjectInputLocator;
        await subjectInput.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Filling discussion subject...');
        await subjectInput.fill(`${subject} - ${username}`);
        console.log('[EVENT] Discussion subject filled.');

        console.log('[EVENT] Locating message body editor...');
        const messageBodyEditor = page.locator('#vB_Editor_001_textarea');
        await messageBodyEditor.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking message body editor to focus...');
        await messageBodyEditor.click();
        console.log('[EVENT] Filling message body...');
        await messageBodyEditor.fill(body);
        console.log('[EVENT] Message body filled.');
        
        // --- STEP 5: SUBMIT THE POST ---
        console.log('[EVENT] Locating "Submit New Thread" button...');
        const postButton = page.locator('#vB_Editor_001_save');
        await postButton.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking "Submit New Thread" button to submit...');
        
        // Click the button and then wait for the URL to change to the new thread's URL.
        await postButton.click();
        await page.waitForURL('**/forum/world/*.html', { timeout: 60000 });

        console.log('[EVENT] "Submit New Thread" button clicked successfully.');

        // --- STEP 6: CAPTURE FINAL URL ---
        console.log('[EVENT] Capturing final URL after post submission...');
        const finalUrl = page.url();
        console.log('[SUCCESS] Final URL after posting:', finalUrl);

        console.log('[EVENT] Waiting 5 seconds to observe the result...');
        await page.waitForTimeout(5000);
        console.log('[EVENT] Post submission wait complete.');

        console.log('[SUCCESS] Script finished successfully.');
        
        await browser.close();
        
        res.status(200).json({ success: true, message: 'Post created successfully.', finalUrl });

    } catch (error) {
        console.error('\n--- [SCRIPT ERROR] ---');
        console.error('[ERROR] Global script error:', error.message);
        console.error('----------------------');
        if (browser) {
            await browser.close();
        }
        res.status(500).json({ success: false, message: 'An error occurred during the operation.', error: error.message });
    }
}; 