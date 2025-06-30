import Facebook from 'facebook-node-sdk';

export async function postToFacebook(credentials, message) {
  return new Promise((resolve, reject) => {
    const facebook = new Facebook({
      appId: credentials.appId,
      secret: credentials.appSecret,
    });

    facebook.setAccessToken(credentials.pageAccessToken);

    facebook.api(`/${credentials.pageId}/feed`, 'post', { message: message }, function(err, res) {
      if (err || !res) {
        console.error('Facebook API Callback Error:', err);
        console.error('Facebook API Callback Response:', res);
        const errorMessage = (err && err.message) || (res && res.error && (res.error.message || JSON.stringify(res.error))) || 'Unknown error occurred during Facebook post';
        return reject({ success: false, error: errorMessage });
      }
      console.log('Facebook Post ID: ' + res.id);
      // Construct a plausible post URL. Facebook doesn't return a direct public URL in this API response.
      // A common way to form it is based on the post ID and page ID.
      const postUrl = `https://www.facebook.com/${credentials.pageId}/posts/${res.id.split('_')[1]}`;
      resolve({ success: true, postUrl: postUrl });
    });
  });
} 