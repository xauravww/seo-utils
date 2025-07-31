import axios from 'axios';
import BaseAdapter from '../BaseAdapter.js';

class DevToAdapter extends BaseAdapter {
    async publish() {
        this.log(`Starting Dev.to publication for ${this.website.url}`, 'info', true);
        const apiKey = this.website.credentials.devtoApiKey || this.website.credentials['devto-api-key'];
        if (!apiKey) {
            const errorMessage = 'Missing dev.to API key in credentials (devtoApiKey or devto-api-key).';
            this.log(errorMessage, 'error', true);
            throw new Error(errorMessage);
        }
        try {
            const articleData = {
                article: {
                    title: this.content.title || 'Untitled',
                    body_markdown: this.content.markdown || this.content.body || '',
                    published: true,
                    series: this.content.series || undefined,
                    main_image: this.content.main_image || undefined,
                    description: this.content.description || this.content.title || '',
                    tags: this.content.tags || '',
                    organization_id: this.content.organization_id || undefined
                }
            };
            const res = await axios.post('https://dev.to/api/articles', articleData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey
                }
            });
            const postUrl = res.data.url;
            this.logPublicationSuccess(postUrl);
            return { success: true, postUrl };
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Dev.to post error: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw new Error(errorMsg);
        }
    }
}

export default DevToAdapter; 