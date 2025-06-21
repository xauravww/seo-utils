import axios from 'axios';
import qs from 'querystring';
import { getSession, setSession } from '../sessionStore.js';

// --- LinkedIn API Functions (update to latest endpoints if available) ---

// Helper to create a log of the request to LinkedIn
const logApiRequest = (method, url, data = null) => {
  console.log(`\n---\nDEBUG: Sending ${method} request to LinkedIn.`);
  console.log(`  URL: ${url}`);
  if (data) {
    console.log(`  Payload: ${JSON.stringify(data, null, 2)}`);
  }
  console.log('---\n');
};

// Helper to log the full error from LinkedIn
const logApiError = (context, error) => {
  console.error(`\n---\nERROR: LinkedIn API request failed in ${context}.`);
  if (error.response) {
    console.error(`  Status: ${error.response.status} - ${error.response.statusText}`);
    console.error(`  Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
    console.error(`  Data: ${JSON.stringify(error.response.data, null, 2)}`);
  } else {
    console.error(`  Message: ${error.message}`);
  }
  console.error('---\n');
};

async function getUserInfo(accessToken) {
  const url = 'https://api.linkedin.com/v2/userinfo';
  logApiRequest('GET', url);
  try {
    const response = await axios.get(url, { 
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    return { sub: response.data.sub };
  } catch (error) {
    logApiError('getUserInfo', error);
    throw new Error('Failed to fetch user info');
  }
}

async function createPost(accessToken, userUrn, text, article = null) {
  const url = 'https://api.linkedin.com/v2/ugcPosts';
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json'
  };
  const specificContent = {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: { text },
      shareMediaCategory: 'NONE'
    }
  };
  if (article && article.url) {
    specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'ARTICLE';
    specificContent['com.linkedin.ugc.ShareContent'].media = [
      {
        status: 'READY',
        originalUrl: article.url,
        title: { text: article.title },
        description: { text: article.description }
      }
    ];
  }
  const data = {
    author: userUrn,
    lifecycleState: 'PUBLISHED',
    specificContent,
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
  };
  logApiRequest('POST', url, data);
  try {
    const response = await axios.post(url, data, { headers });
    return response.data.id;
  } catch (error) {
    logApiError('createPost', error);
    throw error;
  }
}

async function getPost(accessToken, postId) {
  const url = `https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent(postId)}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0'
  };
  const response = await axios.get(url, { headers });
  return response.data;
}

async function deletePost(accessToken, postId) {
  const url = `https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent(postId)}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0'
  };
  await axios.delete(url, { headers });
}

async function updatePost(accessToken, postId, newText) {
  const url = `https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent(postId)}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json'
  };
  const data = {
    "patch": {
      "$set": {
        "specificContent": {
          "com.linkedin.ugc.ShareContent": {
            "shareCommentary": {
              "text": newText
            }
          }
        }
      }
    }
  };
  await axios.patch(url, data, { headers });
}

async function createComment(accessToken, userUrn, postId, text) {
  const url = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
    'LinkedIn-Version': '202506'
  };
  const data = {
    actor: userUrn,
    object: postId,
    message: {
      text: text
    }
  };
  logApiRequest('POST', url, data);
  try {
    await axios.post(url, data, { headers });
  } catch (error) {
    logApiError('createComment', error);
    throw error;
  }
}

async function getComments(accessToken, postId) {
  const url = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments?count=100`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202506'
  };
  const response = await axios.get(url, { headers });
  return response.data.elements;
}

async function deleteComment(accessToken, commentId) {
  const url = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(commentId)}`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202506'
  };
  await axios.delete(url, { headers });
}

// --- Route Handlers ---
const redirectToAuth = (req, res) => {
  console.log('INFO: Redirecting to LinkedIn for authentication...');
  const scope = 'openid profile w_member_social email';

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=${encodeURIComponent(scope)}`;
  res.redirect(authUrl);
};

const handleCallback = async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).json({ error: `Authentication failed: ${error}` });
  try {
    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDIRECT_URI,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET
    };
    const response = await axios.post(tokenUrl, qs.stringify(params), {
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': 'www.linkedin.com'
      }
    });
    const accessToken = response.data.access_token;
    const userInfo = await getUserInfo(accessToken);
    
    if (!userInfo || !userInfo.sub) {
      throw new Error('Failed to get user ID from user info');
    }
    
    // Construct the full URN, which is what the API expects.
    const userUrn = `urn:li:person:${userInfo.sub}`;

    const sessionId = Math.random().toString(36).substring(7);
    setSession(sessionId, { accessToken, userUrn: userUrn }); // Store the full URN
    
    console.log('INFO: Authentication successful, session created.', { sessionId, userUrn: userUrn });
    res.json({
      message: 'Authentication successful. Use the sessionId to make API calls.',
      sessionId,
      userUrn: userUrn // Return the full URN to the client
    });
    
  } catch (error) {
    console.error(`ERROR: Failed during authentication process: ${error.message}`);
    res.status(500).json({
      error: 'Authentication failed',
      details: error.response?.data || error.message
    });
  }
};

const handleCreatePost = async (req, res) => {
  console.log('INFO: handleCreatePost triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { text, article } = req.body;
    console.log(`DEBUG: Received data for new post: sessionId=${sessionId}, text=${text ? `"${text.substring(0, 20)}..."` : 'null'}, article=${article ? JSON.stringify(article) : 'null'}`);
    const session = getSession(sessionId);
    
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }

    const postId = await createPost(session.accessToken, session.userUrn, text, article);
    console.log(`INFO: Post created successfully with ID: ${postId}`);
    res.status(201).json({ 
      message: 'Post created successfully',
      postId 
    });
  } catch (error) {
    // Error is already logged by logApiError
    res.status(500).json({ 
      error: 'Post creation failed',
      details: error.response?.data || { message: error.message }
    });
  }
};

const handleGetPost = async (req, res) => {
  console.log('INFO: handleGetPost triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { postId } = req.params;
    console.log(`DEBUG: Received data for get post: sessionId=${sessionId}, postId=${postId}`);
    const session = getSession(sessionId);
    
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }

    const post = await getPost(session.accessToken, postId);
    console.log(`INFO: Successfully fetched post ${postId}.`);
    res.json(post);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch post',
      details: error.response?.data || { message: error.message }
    });
  }
};

const handleDeletePost = async (req, res) => {
  console.log('INFO: handleDeletePost triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { postId } = req.params;
    console.log(`DEBUG: Received data for delete post: sessionId=${sessionId}, postId=${postId}`);
    const session = getSession(sessionId);
    
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }

    await deletePost(session.accessToken, postId);
    console.log(`INFO: Post ${postId} deleted successfully.`);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ 
      error: 'Post deletion failed',
      details: error.response?.data || { message: error.message }
    });
  }
};

const handleUpdatePost = async (req, res) => {
  console.log('INFO: handleUpdatePost triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { text } = req.body;
    const { postId } = req.params;
    console.log(`DEBUG: Received data for update post: sessionId=${sessionId}, postId=${postId}, text=${text ? `"${text.substring(0, 20)}..."` : 'null'}`);
    const session = getSession(sessionId);

    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }

    await updatePost(session.accessToken, postId, text);
    console.log(`INFO: Post ${postId} updated successfully.`);
    res.json({ message: `Post ${postId} updated successfully` });
  } catch (error) {
    res.status(500).json({
      error: 'Post update failed',
      details: error.response?.data || { message: error.message }
    });
  }
};

const handleCreateComment = async (req, res) => {
  console.log('INFO: handleCreateComment triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { text } = req.body;
    const { postId } = req.params;
    console.log(`DEBUG: Received data for create comment: sessionId=${sessionId}, postId=${postId}, text=${text}`);
    const session = getSession(sessionId);
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }
    await createComment(session.accessToken, session.userUrn, postId, text);
    console.log(`INFO: Comment created successfully on post ${postId}.`);
    res.status(201).json({ message: 'Comment created successfully' });
  } catch (error) {
    logApiError('handleCreateComment', error);
    res.status(500).json({ 
      error: 'Comment creation failed',
      details: error.response?.data || { message: error.message } 
    });
  }
};

const handleGetComments = async (req, res) => {
  console.log('INFO: handleGetComments triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { postId } = req.params;
    console.log(`DEBUG: Received data for get comments: sessionId=${sessionId}, postId=${postId}`);
    const session = getSession(sessionId);
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }
    const comments = await getComments(session.accessToken, postId);
    console.log(`INFO: Successfully fetched comments for post ${postId}.`);
    res.json(comments);
  } catch (error) {
    logApiError('handleGetComments', error);
    res.status(500).json({ 
      error: 'Failed to fetch comments',
      details: error.response?.data || { message: error.message }
    });
  }
};

const handleDeleteComment = async (req, res) => {
  console.log('INFO: handleDeleteComment triggered.');
  try {
    const sessionId = req.headers['x-session-id'];
    const { commentId } = req.params; // commentId identifies the comment to delete
    console.log(`DEBUG: Received data for delete comment: sessionId=${sessionId}, commentId=${commentId}`);
    const session = getSession(sessionId);
    if (!session) {
      console.warn(`WARN: Invalid session ID provided: ${sessionId}`);
      return res.status(401).json({ error: 'Invalid or missing session ID. Please authenticate again via /auth.' });
    }
    await deleteComment(session.accessToken, commentId);
    console.log(`INFO: Comment ${commentId} deleted successfully.`);
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    logApiError('handleDeleteComment', error);
    res.status(500).json({ 
      error: 'Comment deletion failed',
      details: error.response?.data || { message: error.message }
    });
  }
};

export { 
  redirectToAuth, 
  handleCallback,
  handleCreatePost,
  handleGetPost,
  handleDeletePost,
  handleUpdatePost,
  handleCreateComment,
  handleGetComments,
  handleDeleteComment
};
