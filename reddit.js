import axios from 'axios';
import qs from 'qs';

// Your Reddit credentials (replace with actual values)
const CREDENTIALS = {
  clientId: '4y5mkYA3gHECs5Rd_RW2jA',
  clientSecret: 'lwa1SDVkNwV94lTNV5gy-7swbMwqpA',
  username: 'xaurav_',
  password: 'Lover@123'
};

const POST_CONFIG = {
  subreddit: 'cow',
  title: 'My Cow: A True Story from My Childhood',
  text: `
When I was a child growing up in a small village, one of my fondest memories was spending time with our family cow, Gauri. She was gentle, curious, and always seemed to understand when I was feeling down.

I remember one summer afternoon when I sat beside her under the old banyan tree, telling her about my day at school. She listened quietly, occasionally flicking her tail or nudging me with her nose. It might sound silly, but those moments taught me a lot about empathy and the quiet comfort animals can bring.

Taking care of Gauri was a family effort. We’d feed her fresh grass, make sure she had clean water, and sometimes even sing to her in the evenings. In return, she gave us fresh milk and, more importantly, a sense of responsibility and companionship.

Have you ever had a special bond with an animal? I’d love to hear your stories in the comments.

---
*(This post is part of my learning experiment with the Reddit API and Node.js. If it violates any rules, please let me know and I’ll remove it. Thank you!)*

#Essay #ChildhoodMemories #LearningToPost
  `,
  kind: 'self'
};

let cachedAccessToken = null;

async function getRedditAccessToken(forceRefresh = false) {
  if (cachedAccessToken && !forceRefresh) {
    console.log('Using cached access token');
    return cachedAccessToken;
  }

  try {
    const auth = Buffer.from(`${CREDENTIALS.clientId}:${CREDENTIALS.clientSecret}`).toString('base64');
    const data = qs.stringify({
      grant_type: 'password',
      username: CREDENTIALS.username,
      password: CREDENTIALS.password
    });

    const response = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      data,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'NodeJS/RedditAPI/1.0 by YOUR_REDDIT_USERNAME'
        }
      }
    );

    cachedAccessToken = response.data.access_token;
    console.log('New access token obtained');
    console.log("cachedAccessToken: ",cachedAccessToken);
    return cachedAccessToken;
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    throw error;
  }
}

async function submitRedditPost(accessToken) {
  try {
    const data = qs.stringify({
      sr: POST_CONFIG.subreddit,
      kind: POST_CONFIG.kind,
      title: POST_CONFIG.title,
      text: POST_CONFIG.text,
      api_type: 'json'
    });

    const response = await axios.post(
      'https://oauth.reddit.com/api/submit',
      data,
      {
        headers: {
          'Authorization': `bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'NodeJS/RedditAPI/1.0 by YOUR_REDDIT_USERNAME'
        }
      }
    );

    // Extract and format the post URL
    const relativeUrl = response.data.json.data.url;
    return `${relativeUrl}`;
  } catch (error) {
    console.error('Error creating post:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    // Pass true to forceRefresh to get a new token, false to use cached token if available
    const accessToken = await getRedditAccessToken(false);
    console.log('Access token obtained');
    
    const postUrl = await submitRedditPost(accessToken);
    console.log('\n✅ Post created successfully!');
    console.log('📬 Post URL:', postUrl);
    return postUrl;
  } catch (error) {
    console.error('\n❌ Post creation failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
