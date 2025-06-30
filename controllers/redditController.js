import axios from 'axios';
import qs from 'qs';

// Helper function to get the Reddit Access Token
export async function getRedditAccessToken(clientId, clientSecret, username, password) {
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const data = qs.stringify({
      grant_type: 'password',
      username: username,
      password: password
    });

    const response = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      data,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': `NodeJS/RedditAPI/1.0 by ${username}`
        }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    // Re-throw the error to be caught by the main controller function
    throw new Error('Failed to get Reddit access token. Check credentials.');
  }
}

// Helper function to submit the post
export async function submitRedditPost(accessToken, subreddit, title, text, username) {
  try {
    const data = qs.stringify({
      sr: subreddit,
      kind: 'self',
      title: title,
      text: text,
      api_type: 'json'
    });

    const response = await axios.post(
      'https://oauth.reddit.com/api/submit',
      data,
      {
        headers: {
          'Authorization': `bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': `NodeJS/RedditAPI/1.0 by ${username}`
        }
      }
    );
    // Return the full URL of the created post
    return response.data.json.data.url;
  } catch (error) {
    console.error('Error creating post:', error.response?.data || error.message);
    throw new Error('Failed to create Reddit post.');
  }
}

// Main controller function
export const postToReddit = async (req, res) => {
  const { clientId, clientSecret, username, password, subreddit, title, text} = req.body;

  if (!clientId || !clientSecret || !username || !password || !subreddit || !title || !text) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields. Please provide clientId, clientSecret, username, password, subreddit, title, and text.' 
    });
  }

  try {
    console.log('Attempting to get Reddit access token...');
    const accessToken = await getRedditAccessToken(clientId, clientSecret, username, password);
    console.log('Access token obtained successfully.');

    console.log('Submitting post to Reddit...');
    const postUrl = await submitRedditPost(accessToken, subreddit, title, text, username);
    
    console.log('\n✅ Post created successfully!');
    console.log('📬 Post URL:', postUrl);

    return res.json({ success: true, url: postUrl });

  } catch (error) {
    console.error('\n❌ Post creation failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}; 