import BaseAdapter from '../BaseAdapter.js';
import { sendTweet } from '../../controllers/social_media/twitterController.js';

class TwitterAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering TwitterAdapter publish method.`, 'info', true);
        const { appKey, appSecret, accessToken, accessSecret } = this.website.credentials;
        const tweetText = this.content.body; // Assuming the tweet content is in content.body

        if (!appKey || !appSecret || !accessToken || !accessSecret || !tweetText) {
            const errorMessage = 'Missing required Twitter credentials or tweet text.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to send tweet...', 'detail', false);
            const tweetResult = await sendTweet({ appKey, appSecret, accessToken, accessSecret }, tweetText);

            if (tweetResult.success) {
                this.log(`[SUCCESS] Tweet posted successfully! URL: ${tweetResult.tweetUrl}`, 'success', true);
                return { success: true, tweetUrl: tweetResult.tweetUrl };
            } else {
                throw new Error(tweetResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Twitter post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

export default TwitterAdapter; 