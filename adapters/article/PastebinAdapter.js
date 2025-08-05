import axios from 'axios';
import BaseAdapter from '../BaseAdapter.js';

class PastebinAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.baseUrl = 'https://pastebin.com/api/';
    }

    async publish() {
        this.log(`Starting Pastebin publication for ${this.website.url}`, 'info', true);
        
        const { devKey } = this.website.credentials;
        if (!devKey) {
            const errorMessage = 'Missing Pastebin developer key in credentials (devKey).';
            this.log(errorMessage, 'error', true);
            throw new Error(errorMessage);
        }

        try {
            // Determine content and format - prioritize markdown
            let content = '';
            let format = 'text';

            if (this.content.markdown) {
                content = this.content.markdown;
                // Pastebin doesn't have a specific markdown format, use text
                format = 'text';
                this.log('Using markdown content with text format (Pastebin doesn\'t support markdown format)', 'detail', false);
            } else if (this.content.body) {
                content = this.content.body;
                // Try to detect if it's HTML
                if (content.trim().startsWith('<') && content.trim().includes('>')) {
                    format = 'html5';
                } else {
                    format = this.content.format || 'text';
                }
            }

            const pasteUrl = await this.createPaste({
                devKey,
                code: content,
                title: this.content.title || 'Untitled',
                format: format,
                privacy: '0' // Always public for SEO
                // No expiration - paste will remain forever
            });

            this.logPublicationSuccess(pasteUrl);
            return { success: true, postUrl: pasteUrl };
        } catch (error) {
            this.log(`Publication failed: ${error.message}`, 'error', true);
            throw error;
        }
    }

    /**
     * Create a new Paste using the developer key (guest mode).
     * Always creates public pastes with no expiration for SEO purposes.
     */
    async createPaste({ devKey, code, title = "Untitled", format = "text", privacy = "0" }) {
        if (!code) {
            throw new Error("Paste code cannot be empty.");
        }

        this.log(`Creating paste with title: ${title}`, 'detail', false);

        const payload = new URLSearchParams({
            api_dev_key: devKey,
            api_option: 'paste',
            api_paste_code: code,
            api_paste_name: title,
            api_paste_format: format,
            api_paste_private: privacy,
            // No expiration date - paste will remain forever for SEO
        });

        const response = await axios.post(`${this.baseUrl}api_post.php`, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const data = response.data;
        if (typeof data === 'string' && data.startsWith('Bad API request')) {
            throw new Error(data);
        }

        this.log(`Paste created successfully`, 'detail', false);
        return data; // Paste URL
    }
}

export default PastebinAdapter;
