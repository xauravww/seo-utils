import BaseAdapter from '../BaseAdapter.js';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import axios from 'axios';

class PlurkAdapter extends BaseAdapter {
  constructor(args) {
    super(args);
  }

  async publish() {
    this.log(`[EVENT] Entering PlurkAdapter publish method.`, 'info', true);

    const {
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    } = this.website.credentials || {};

    let content = this.content.body;
    const PLURK_CHARACTER_LIMIT = 360;

    if (
      !consumerKey ||
      !consumerSecret ||
      !accessToken ||
      !accessTokenSecret ||
      !content
    ) {
      const errorMessage = 'Missing required Plurk credentials or content.';
      this.log(`[ERROR] ${errorMessage}`, 'error', true);
      throw new Error(errorMessage);
    }

    // Truncate content if needed
    if (content.length > PLURK_CHARACTER_LIMIT) {
      const truncationMarker = '...';
      content = content.substring(0, PLURK_CHARACTER_LIMIT - truncationMarker.length) + truncationMarker;
      this.log(`[WARN] Content was too long for Plurk and has been truncated to ${PLURK_CHARACTER_LIMIT} characters.`, 'warn', true);
    }

    // OAuth 1.0a setup
    const oauth = new OAuth({
      consumer: { key: consumerKey, secret: consumerSecret },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });

    const url = 'https://www.plurk.com/APP/Timeline/plurkAdd';

    // Parameters: Omit nulls
    const bodyParameters = {
      content: content,
      qualifier: ':',       // Exactly as in the console (":" means 'says')
      lang: 'en',
      no_comments: 0,
      replurkable: 1,
      porn: 0,
      publish_to_anonymous: 0,
      publish_to_followers: 0,
    };

    // Prepare OAuth-signed request
    const requestData = {
      url: url,
      method: 'POST',
      data: bodyParameters,
    };

    const token = { key: accessToken, secret: accessTokenSecret };
    const headers = oauth.toHeader(oauth.authorize(requestData, token));
    headers['Content-Type'] = 'application/x-www-form-urlencoded';

    try {
      this.log('[EVENT] Attempting to create Plurk post...', 'detail', false);

      // Build application/x-www-form-urlencoded body to match signature
      const params = new URLSearchParams(bodyParameters);

      // DEBUG: show signature base string/curl for troubleshooting
      const debugCurl = [
        `curl -X POST "${url}"`,
        `-H 'Authorization: ${headers.Authorization}'`,
        `-H 'Content-Type: ${headers['Content-Type']}'`,
        ...Object.entries(bodyParameters).map(([k, v]) =>
          `--data-urlencode '${k}=${String(v).replace(/'/g, "'\\''")}'`
        )
      ].join(' \\\n');
      this.log(`[DEBUG] Equivalent curl command:\n${debugCurl}`, 'debug', true);

      // Actual request
      const response = await axios.post(url, params.toString(), { headers });

      const plurkId = response.data?.plurk_id;
      if (plurkId) {
        const postUrl = `https://www.plurk.com/p/${plurkId.toString(36)}`;
        this.log(`[SUCCESS] Plurk created successfully: ${postUrl}`, 'success', true);
        return { success: true, postUrl: postUrl, data: response.data };
      } else {
        this.log(`[SUCCESS] Plurk created (but no plurk_id): ${JSON.stringify(response.data)}`, 'success', true);
        return { success: true, data: response.data };
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error_text || error.response?.data || error.message;
      this.log(`[ERROR] Plurk post failed: ${errorMessage}`, 'error', true);
      
      if (error.response) {
        try {
          const safeResponse = JSON.stringify(error.response, Object.getOwnPropertyNames(error.response));
          this.log(`[ERROR] Full error response: ${safeResponse}`, 'error', true);
        } catch (jsonError) {
          this.log(`[ERROR] Failed to stringify full error response: ${jsonError.message}`, 'error', true);
        }
      }
      throw error;
    }
  }
}

export default PlurkAdapter;
