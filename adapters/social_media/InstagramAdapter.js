import BaseAdapter from '../BaseAdapter.js';
import { postToInstagram } from '../../controllers/social_media/instagramController.js';

class InstagramAdapter extends BaseAdapter {
    constructor(args) {
        super(args);
    }

    async publish() {
        this.log(`[EVENT] Entering InstagramAdapter publish method.`, 'info', true);
        const { pageId, accessToken } = this.website.credentials;
        const { imageUrl, caption } = this.content; // Assuming content will have imageUrl and caption

        if (!pageId || !accessToken || !imageUrl || !caption) {
            const errorMessage = 'Missing required Instagram credentials or content fields (pageId, accessToken, imageUrl, caption).';
            this.log(`[ERROR] ${errorMessage}`, 'error', true);
            throw error;
        }

        try {
            this.log('[EVENT] Attempting to post to Instagram...', 'detail', false);
            const instagramPostResult = await postToInstagram({ pageId, accessToken }, { imageUrl, caption });

            if (instagramPostResult.success) {
                this.logPublicationSuccess(instagramPostResult.postUrl);
                return { success: true, postUrl: instagramPostResult.postUrl };
            } else {
                throw new Error(instagramPostResult.error);
            }
        } catch (error) {
            this.log(`[ERROR] Instagram post failed: ${error.message}`, 'error', true);
            throw error;
        }
    }
}

export default InstagramAdapter; 