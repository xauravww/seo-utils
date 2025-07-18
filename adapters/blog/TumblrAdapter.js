import { OAuth } from 'oauth';
import BaseAdapter from '../BaseAdapter.js';

class TumblrAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
        this.consumerKey = this.website.credentials.consumerKey;
        this.consumerSecret = this.website.credentials.consumerSecret;
        this.accessToken = this.website.credentials.accessToken;
        this.accessTokenSecret = this.website.credentials.accessTokenSecret;
        this.blogHostname = this.website.credentials.blogHostname;
    }

    async publish() {
        this.log(`[EVENT] Entering TumblrAdapter publish method for ${this.blogHostname}.`, 'info', true);
        if (!this.consumerKey || !this.consumerSecret || !this.accessToken || !this.accessTokenSecret || !this.blogHostname) {
            const errorMessage = 'Missing Tumblr credentials (consumerKey, consumerSecret, accessToken, accessTokenSecret, blogHostname).';
            this.log(errorMessage, 'error', true);
            throw new Error(errorMessage);
        }
        const oauth = new OAuth(
            'https://www.tumblr.com/oauth/request_token',
            'https://www.tumblr.com/oauth/access_token',
            this.consumerKey,
            this.consumerSecret,
            '1.0A',
            null,
            'HMAC-SHA1'
        );
        let bodyContent = this.content.body || this.content.markdown || this.content.html || '';
        if (this.content.markdown) {
            bodyContent = bodyContent
                .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
                .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
                .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
                .replace(/^### (.*)$/gm, '<h3>$1</h3>')
                .replace(/^## (.*)$/gm, '<h2>$1</h2>')
                .replace(/^# (.*)$/gm, '<h1>$1</h1>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.*?)__/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/_(.*?)_/g, '<em>$1</em>')
                .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>')
                .replace(/\n/g, '<br/>');
        }
        const postData = {
            type: 'text',
            title: this.content.title || 'Untitled',
            body: bodyContent
        };
        const url = `https://api.tumblr.com/v2/blog/${this.blogHostname}/post`;
        return new Promise((resolve) => {
            oauth.post(url, this.accessToken, this.accessTokenSecret, postData, (err, data) => {
                if (err) {
                    this.log('Failed to post to Tumblr: ' + JSON.stringify(err), 'error', true);
                    resolve({ success: false, error: err });
                } else {
                    this.log('Successfully created Tumblr post: ' + data, 'success', true);
                    let postUrl = null;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed.response && parsed.response.id && this.blogHostname) {
                            postUrl = `https://${this.blogHostname}/post/${parsed.response.id}`;
                        }
                    } catch (e) {
                        this.log('Failed to parse Tumblr response: ' + e.message, 'error', true);
                    }
                    resolve({ success: true, postUrl, response: data });
                }
            });
        });
    }
}

export default TumblrAdapter; 