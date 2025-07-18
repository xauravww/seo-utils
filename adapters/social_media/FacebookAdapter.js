import BaseAdapter from '../BaseAdapter.js';
import { postToFacebook } from '../../controllers/social_media/facebookController.js';

class FacebookAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering FacebookAdapter publish method.`, 'info', true);
        const { appId, appSecret, pageAccessToken, pageId } = this.website.credentials;
        const message = this.content.body; // Assuming the post content is in content.body

        if (!appId || !appSecret || !pageAccessToken || !pageId || !message) {
            const errorMessage = 'Missing required Facebook credentials or post message.';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to post to Facebook...', 'detail', false);
            const facebookPostResult = await postToFacebook({ appId, appSecret, pageAccessToken, pageId }, message);

            if (facebookPostResult.success) {
                this.log(`[SUCCESS] Facebook post created successfully! URL: ${facebookPostResult.postUrl}`, 'success', true);
                return { success: true, postUrl: facebookPostResult.postUrl };
            } else {
                throw new Error(facebookPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Facebook post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

export default FacebookAdapter; 