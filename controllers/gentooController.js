import { chromium } from 'playwright';

export const postToGentooForums = async (req, res) => {
    const { username, password, subject, body } = req.body;

    if (!username || !password || !subject || !body) {
        return res.status(400).json({ error: 'Missing required fields: username, password, subject, body' });
    }

    let browser;
    try {
        console.log('[EVENT] Launching browser for Gentoo Forums...');
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        //====================================================================
        // OPTIMIZATION: Block unnecessary resources
        //====================================================================
        await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', (route) => {
            if (route.request().url().includes('lang_english/post.gif')) {
                route.continue();
            } else {
                route.abort();
            }
        });
        await page.route('**/*google-analytics.com*', (route) => route.abort());
        await page.route('**/*doubleclick.net*', (route) => route.abort());

        //====================================================================
        // AUTOMATION SCRIPT LOGIC
        //====================================================================
        // --- STEP 1: NAVIGATE TO LOGIN ---
        console.log('[EVENT] Navigating to the main page...');
        await page.goto('https://forums.gentoo.org/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Main page navigation complete.');

        console.log('[EVENT] Clicking "Log in" link...');
        await page.getByRole('link', { name: 'Log in', exact: true }).click();
        await page.waitForURL('**/login.php**', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Navigated to login page.');
        
        // --- STEP 2: FILL LOGIN FORM AND SUBMIT ---
        console.log('[EVENT] Filling username...');
        await page.locator('input[name="username"]').fill(username);
        console.log('[EVENT] Filling password...');
        await page.locator('input[name="password"]').fill(password);
        
        console.log('[EVENT] Clicking login button...');
        await page.locator('input[name="login"][value="Log in"]').click();
        await page.waitForURL(/index\.php/, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[SUCCESS] Login successful.');

        // --- STEP 3: NAVIGATE DIRECTLY TO NEW TOPIC PAGE ---
        console.log('[EVENT] Navigating directly to the new topic page...');
        await page.goto('https://forums.gentoo.org/posting.php?mode=newtopic&f=7', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] "Post new topic" page loaded.');

        // --- STEP 4: FILL OUT THE NEW TOPIC FORM ---
        console.log('[EVENT] Filling subject...');
        await page.locator('input[name="subject"]').fill(subject);
        console.log('[EVENT] Filling message body...');
        
        const messageTextarea = page.locator('textarea[name="message"]');
        if (!await messageTextarea.isVisible()) {
            console.log('[INFO] Textarea not visible, attempting to switch to source mode...');
            const toggleButton = page.locator('a[title="Toggle view"]').first();
            if (await toggleButton.isVisible()) {
                await toggleButton.click();
                console.log('[INFO] Switched to source mode.');
            }
        }
        await messageTextarea.fill(body);
        
        // --- STEP 5: SUBMIT THE POST ---
        console.log('[EVENT] Clicking "Submit" button...');
        await page.locator('input[name="post"][value="Submit"]').click();
        await page.waitForURL(/viewtopic-p-.*\.html/, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Post submitted successfully and navigated to the new topic.');

        // --- STEP 6: CAPTURE FINAL URL ---
        const finalUrl = page.url();
        console.log('[SUCCESS] Final URL after posting:', finalUrl);

        console.log('[SUCCESS] Script finished successfully.');
        
        // await browser.close(); // Browser will not be closed as per user request.
        
        res.status(200).json({ success: true, message: 'Post created successfully on Gentoo Forums.', finalUrl });

    } catch (error) {
        console.error('\n--- [SCRIPT ERROR] ---');
        console.error('[ERROR] Gentoo script error:', error.message);
        console.error('----------------------');
        if (browser) {
            // await browser.close(); // Do not close browser on error either, to allow for debugging.
        }
        res.status(500).json({ success: false, message: 'An error occurred during the Gentoo forums operation.', error: error.message });
    }
}; 