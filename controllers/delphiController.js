import { chromium } from 'playwright';

export const postToDelphiForums = async (req, res) => {
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
        await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', (route) => route.abort());
        await page.route('**/*google-analytics.com*', (route) => route.abort());
        await page.route('**/*doubleclick.net*', (route) => route.abort());
        await page.route('**/*twitter.com*', (route) => route.abort());

        //====================================================================
        // AUTOMATION SCRIPT LOGIC
        //====================================================================
        // --- STEP 1: LOGIN ---
        console.log('[EVENT] Navigating to the login page...');
        await page.goto('https://secure.delphiforums.com/n/login/login.aspx?webtag=dflogin&seamlesswebtag=https%3a%2f%2fdelphiforums.com%2f%3fredirCnt%3d1', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Login page navigation complete.');

        console.log('[EVENT] Locating username field...');
        const usernameField = page.locator('#lgnForm_username');
        await usernameField.waitFor({ state: 'visible', timeout: 10000 });
        console.log('[EVENT] Filling username field...');
        await usernameField.fill(username);
        console.log('[EVENT] Username field filled.');

        console.log('[EVENT] Locating password field...');
        const passwordField = page.locator('#lgnForm_password');
        await passwordField.waitFor({ state: 'visible', timeout: 10000 });
        console.log('[EVENT] Filling password field...');
        await passwordField.fill(password);
        console.log('[EVENT] Password field filled.');

        console.log('[EVENT] Locating login button...');
        const loginButton = page.locator('#df_lgnbtn');
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
        await page.goto('https://forums.delphiforums.com/shamsconsultant', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[EVENT] Forum page navigation complete.');

        // --- STEP 3: CLICK "NEW TOPIC" BUTTON ---
        console.log('[EVENT] Locating "New Topic" button...');
        const newTopicButton = page.locator('#df_mainstream > div.df-contenthead.df-ch-feed.df-xshide > button.btn.btn-primary.pull-right.df-mainnav.df-new.df-full');
        await newTopicButton.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking "New Topic" button...');
        await newTopicButton.click({ timeout: 10000 });
        console.log('[EVENT] "New Topic" button clicked successfully.');

        // --- STEP 4: FILL OUT THE NEW TOPIC FORM ---
        console.log('[EVENT] Locating discussion subject field...');
        const subjectInput = page.locator('#msg_subject');
        await subjectInput.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Filling discussion subject...');
        await subjectInput.fill(subject);
        console.log('[EVENT] Discussion subject filled.');

        console.log('[EVENT] Locating message body editor...');
        const messageBodyEditor = page.locator('#cke_1_contents > div');
        await messageBodyEditor.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking message body editor to focus...');
        await messageBodyEditor.click();
        console.log('[EVENT] Filling message body...');
        await messageBodyEditor.fill(body);
        console.log('[EVENT] Message body filled.');
        
        // --- STEP 5: SUBMIT THE POST ---
        console.log('[EVENT] Locating "Post" button...');
        const postButton = page.locator('button[onclick^="dfns.doPost"]');
        await postButton.waitFor({ state: 'visible', timeout: 30000 });
        console.log('[EVENT] Clicking "Post" button to submit...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
            postButton.click()
        ]);
        console.log('[EVENT] "Post" button clicked successfully.');

        // --- STEP 6: CAPTURE FINAL URL ---
        console.log('[EVENT] Capturing final URL after post submission...');
        const finalUrl = await page.url();
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