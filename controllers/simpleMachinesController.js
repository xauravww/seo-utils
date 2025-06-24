import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SpeechClient } from '@google-cloud/speech';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import https from 'https';

chromium.use(StealthPlugin());

async function solveRecaptcha(page) {
    console.log('[EVENT] Attempting to solve reCAPTCHA via audio...');

    await page.waitForSelector('iframe[src*="api2/anchor"]');
    const recaptchaFrame = page.frame({ url: /api2\/anchor/ });
    
    const checkbox = await recaptchaFrame.waitForSelector('#recaptcha-anchor');
    await checkbox.click();

    await page.waitForSelector('iframe[src*="api2/bframe"]');
    const challengeFrame = page.frame({ url: /api2\/bframe/ });

    const audioButton = await challengeFrame.waitForSelector('#recaptcha-audio-button');
    await audioButton.click();

    const audioLink = await challengeFrame.waitForSelector('a.rc-audiochallenge-tdownload-link');
    const audioUrl = await audioLink.getAttribute('href');

    const audioPath = path.resolve(process.cwd(), 'captcha_audio.mp3');
    const outputPath = path.resolve(process.cwd(), 'captcha_audio.wav');
    
    await new Promise((resolve, reject) => {
        https.get(audioUrl, (response) => {
            const fileStream = fs.createWriteStream(audioPath);
            response.pipe(fileStream);
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });
    });

    await new Promise((resolve, reject) => {
        ffmpeg(audioPath)
            .toFormat('wav')
            .on('error', reject)
            .on('end', resolve)
            .save(outputPath);
    });

    const speechClient = new SpeechClient({
        keyFilename: path.resolve(process.cwd(), 'google-credentials.json')
    });

    const audioBytes = fs.readFileSync(outputPath).toString('base64');
    const audio = { content: audioBytes };
    const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
    };
    const request = { audio, config };
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');

    console.log('[INFO] Transcription result:', transcription);
    await challengeFrame.type('#audio-response', transcription);
    await challengeFrame.click('#recaptcha-verify-button');
    
    fs.unlinkSync(audioPath);
    fs.unlinkSync(outputPath);
    console.log('[SUCCESS] reCAPTCHA challenge submitted.');
}

export const postToSimpleMachines = async (req, res) => {
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

        console.log('[EVENT] Navigating to the forum...');
        await page.goto('https://www.simplemachines.org/community/', { waitUntil: 'domcontentloaded' });

        console.log('[EVENT] Clicking login button...');
        await page.locator('#top_info > li.button_login > a').click();

        const loginPopup = page.locator('#smf_popup > div > div.popup_content');
        await loginPopup.waitFor({ state: 'visible', timeout: 10000 });

        console.log('[EVENT] Filling username...');
        await loginPopup.locator('#ajax_loginuser').fill(username);

        console.log('[EVENT] Filling password...');
        await loginPopup.locator('#ajax_loginpass').fill(password);

        console.log('[EVENT] Submitting login...');
        await loginPopup.locator('input[type="submit"][value="Log in"]').click();
        
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[SUCCESS] Login successful.');

        console.log('[EVENT] Navigating to the board...');
        await page.goto('https://www.simplemachines.org/community/index.php?board=7.0', { waitUntil: 'domcontentloaded' });

        console.log('[EVENT] Clicking "New Topic"...');
        await page.getByRole('link', { name: 'New topic' }).first().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('[EVENT] Filling subject...');
        await page.locator('#subject').fill(subject);

        console.log('[EVENT] Filling body...');
        await page.locator('textarea[name="message"]').fill(body);

        await solveRecaptcha(page);

        console.log('[EVENT] Submitting post...');
        await page.locator('input[name="post"][value="Post"]').click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('[EVENT] Extracting final URL...');
        const topicLinkLocator = page.locator(`.windowbg .message_index_title a`).first();
        const finalUrl = await topicLinkLocator.getAttribute('href');
        
        console.log('[SUCCESS] Post created successfully. Final URL:', finalUrl);
        await browser.close();
        res.status(200).json({ success: true, message: 'Post created successfully.', finalUrl });

    } catch (error) {
        console.error('\n--- [SCRIPT ERROR] ---');
        console.error('[ERROR] Global script error:', error.message);
        console.error('----------------------');
        if (browser) await browser.close();
        res.status(500).json({ success: false, message: 'An error occurred.', error: error.message });
    }
}; 