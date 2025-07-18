import axios from 'axios';
import BaseAdapter from '../BaseAdapter.js';

class HashnodeAdapter extends BaseAdapter {
    async publish() {
        this.log(`Starting Hashnode publication for ${this.website.url}`, 'info', true);
        const apiToken = this.website.credentials.hashnodeApiToken || this.website.credentials['hashnode-api-token'];
        const username = this.website.credentials.hashnodeUsername || this.website.credentials['hashnode-username'];
        if (!apiToken || !username) {
            const errorMessage = 'Missing Hashnode API token or username in credentials (hashnodeApiToken/hashnode-api-token, hashnodeUsername/hashnode-username).';
            this.log(errorMessage, 'error', true);
            throw new Error(errorMessage);
        }
        function slugify(str) {
            return str.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-');
        }
        const pubQuery = `
            query PublicationInfo($host: String!) {
              publication(host: $host) {
                id
                title
                author { name username }
              }
            }
        `;
        let publicationId;
        try {
            const pubRes = await axios.post(
                'https://gql.hashnode.com/',
                {
                    query: pubQuery,
                    variables: { host: `${username}.hashnode.dev` }
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            const publication = pubRes.data.data.publication;
            if (!publication) {
                throw new Error('Publication not found');
            }
            publicationId = publication.id;
            this.log(`Found publication: ${publication.title}`, 'info', true);
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Failed to get publication ID: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw new Error(errorMsg);
        }
        const postQuery = `
            mutation PublishPost($input: PublishPostInput!) {
              publishPost(input: $input) {
                post { url }
              }
            }
        `;
        const title = this.content.title || 'Untitled';
        const slug = slugify(title);
        const contentMarkdown = this.content.markdown || this.content.body || '# Hello Hashnode';
        const tags = this.content.tagsArray || this.content.tags || [];
        let tagsArr = Array.isArray(tags) ? tags : [];
        if (typeof tags === 'string' && tags) {
            tagsArr = tags.split(',').map(t => ({ name: t.trim() }));
        }
        try {
            const postRes = await axios.post(
                'https://gql.hashnode.com/',
                {
                    query: postQuery,
                    variables: {
                        input: {
                            publicationId: publicationId,
                            title: title,
                            contentMarkdown: contentMarkdown,
                            tags: tagsArr
                        }
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            const post = postRes.data.data.publishPost.post;
            if (!post || !post.url) {
                throw new Error('No post URL returned');
            }
            this.log(`Hashnode post published: ${post.url}`, 'success', true);
            return { success: true, postUrl: post.url };
        } catch (err) {
            const errorMsg = err.response?.data || err.message;
            this.log(`Failed to publish post: ${JSON.stringify(errorMsg)}`, 'error', true);
            throw new Error(errorMsg);
        }
    }
}

export default HashnodeAdapter; 