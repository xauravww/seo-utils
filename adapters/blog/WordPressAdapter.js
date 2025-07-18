import { chromium } from 'patchright';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import cloudinary from 'cloudinary';
import fs from 'fs';
// Import BaseAdapter from the main adapters directory (will be created soon)
import BaseAdapter from '../BaseAdapter.js';

class WordPressAdapter extends BaseAdapter {
    // Helper to convert markdown to basic HTML, then allow only certain tags
    static toBasicHtml(input) {
        if (!input) return '';
        let html = input;
        // --- Basic Markdown to HTML conversion ---
        // Headings
        html = html.replace(/^###### (.*)$/gm, '<strong><em>$1</em></strong>')
            .replace(/^##### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^#### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^### (.*)$/gm, '<strong>$1</strong>')
            .replace(/^## (.*)$/gm, '<strong>$1</strong>')
            .replace(/^# (.*)$/gm, '<strong>$1</strong>');
        // Bold **text** or __text__
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>');
        // Italic *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>');
        // Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // Unordered lists
        html = html.replace(/^[\*\-\+] (.*)$/gm, '<br/>&nbsp;&nbsp;• $1');
        // Paragraphs (double newlines)
        html = html.replace(/\n{2,}/g, '<br/><br/>');
        // Inline code (not allowed, so escape)
        html = html.replace(/`([^`]+)`/g, '&lt;code&gt;$1&lt;/code&gt;');
        // --- End Markdown to HTML ---
        // Now escape all < and >
        let safe = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Unescape allowed tags
        safe = safe.replace(/&lt;a ([^&]*)&gt;/gi, '<a $1>')
            .replace(/&lt;\/a&gt;/gi, '</a>');
        safe = safe.replace(/&lt;strong&gt;/gi, '<strong>')
            .replace(/&lt;\/strong&gt;/gi, '</strong>');
        safe = safe.replace(/&lt;em&gt;/gi, '<em>')
            .replace(/&lt;\/em&gt;/gi, '</em>');
        safe = safe.replace(/&lt;!--more--&gt;/gi, '<!--more-->');
        safe = safe.replace(/&amp;nbsp;/gi, '&nbsp;');
        safe = safe.replace(/&lt;br\/?&gt;/gi, '<br/>');
        return safe;
    }

    async loginAndExtract() {
        let browser;
        this.log(`Launching browser for login at ${this.website.url}`, 'detail', false);
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({ ignoreHTTPSErrors: true });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);

            // Construct the standard WordPress login URL and navigate there directly.
            const loginUrl = `${this.website.url.replace(/\/$/, '')}/login`;
            this.log(`Navigating to login page: ${loginUrl}`, 'detail', false);
            await page.goto(loginUrl, { waitUntil: 'networkidle' });

            // Add the user's provided selectors to make the locator more robust.
            const usernameLocator = page.locator('input[name="username"], input[name="user_login"], input[name="log"], input[name="usr"]');
            const passwordLocator = page.locator('input[name="password"], input[name="user_pass"], input[name="pwd"], input[name="pass"]');
            // Use credentials from the website object
            await usernameLocator.fill(this.website.credentials.username);
            await passwordLocator.fill(this.website.credentials.password);

            this.log('Credentials filled. Clicking submit...', 'detail', false);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle' }),
                page.click('input[type="submit"], button[type="submit"], #wp-submit')
            ]);

            const newPostUrl = `${this.website.url.replace(/\/$/, '')}/new-post`;
            this.log(`Logged in. Navigating to new post page: ${newPostUrl}`, 'detail', false);
            await page.goto(newPostUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('form[id="post"]', { timeout: 15000 });

            const cookies = await context.cookies();
            const hiddenInputs = await page.$$eval('form[id="post"] input[type="hidden"]', inputs =>
                inputs.reduce((obj, el) => {
                    obj[el.name] = el.value;
                    return obj;
                }, {})
            );

            this.log(`Extracted ${cookies.length} cookies and ${Object.keys(hiddenInputs).length} hidden inputs.`, 'info', false);
            return { cookies, hiddenInputs, newPostUrl };
        } finally {
            if (browser) {
                await browser.close();
                this.log(`Browser closed after extraction.`, 'detail', false);
            }
        }
    }

    async postWithAxios(cookies, hiddenInputs, newPostUrl) {
        this.log('Posting article with extracted session data...', 'detail', false);
        const jar = new CookieJar();
        for (const cookie of cookies) {
            const url = `https://${cookie.domain.replace(/\/$/, '')}`;
            await jar.setCookie(`${cookie.name}=${cookie.value}`, url);
        }

        const client = wrapper(axios.create({ jar }));

        // Convert content.body to basic HTML
        const htmlBody = WordPressAdapter.toBasicHtml(this.content.body);
        const form = { ...hiddenInputs, post_title: this.content.title, content: htmlBody, publish: 'Publish' };
        const body = new URLSearchParams(form).toString();

        const postRes = await client.post(newPostUrl, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const $ = load(postRes.data);
        // Extract post URL from response
        let postUrl = $('#successfully_posted_url a').attr('href');
        if (!postUrl) {
            postUrl = $('#published-url a').attr('href');
        }

        if (!postUrl) {
            this.log('Failed to find post URL in response. The page HTML will be logged for debugging.', 'error', true);
            throw new Error('Could not find the final post URL in the response page. Check logs for HTML snippet.');
        }

        const successMessage = `Successfully extracted post URL: ${postUrl}`;
        this.log(successMessage, 'success', true);
        console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
        return postUrl;
    }

    async publish() {
        this.log(`Starting WordPress publication for ${this.website.url}`, 'info', true);
        try {
            const { cookies, hiddenInputs, newPostUrl } = await this.loginAndExtract();
            const postUrl = await this.postWithAxios(cookies, hiddenInputs, newPostUrl);
            const successMessage = `Publication successful! URL: ${postUrl}`;
            this.log(successMessage, 'success', true);
            console.log(`[${this.requestId}] [WordPressAdapter] ${successMessage}`);
            return { success: true, postUrl };
        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            console.error(`[${this.requestId}] [WordPressAdapter] Publication failed for ${this.website.url}:`, error.message);
            throw error;
        }
    }
}

export default WordPressAdapter; 