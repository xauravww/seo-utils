import BaseAdapter from '../BaseAdapter.js';
import { getRedditAccessToken, submitRedditPost } from '../../controllers/redditController.js';

class RedditAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering RedditAdapter publish method for ${this.website.url}.`, 'info', true);
        const { clientId, clientSecret, username, password, subreddit } = this.website.credentials;
        const { title, body } = this.content;

        if (!clientId || !clientSecret || !username || !password || !subreddit || !title || !body) {
            const errorMessage = 'Missing required Reddit credentials or content fields.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to get Reddit access token...', 'detail', false);
            const accessToken = await getRedditAccessToken(clientId, clientSecret, username, password);
            this.log('[SUCCESS] Access token obtained successfully.', 'success', true);

            this.log('[EVENT] Submitting post to Reddit...', 'detail', false);
            const postUrl = await submitRedditPost(accessToken, subreddit, title, body, username);

            this.logPublicationSuccess(postUrl);
            return { success: true, postUrl: postUrl };

        } catch (error) {
            this.log(`[ERROR] Reddit post creation failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

export default RedditAdapter; 