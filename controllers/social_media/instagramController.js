import axios from 'axios';

export async function postToInstagram(credentials, content) {
  const { pageId, accessToken } = credentials;
  const { imageUrl, caption } = content; // Assuming content will have imageUrl and caption

  if (!pageId || !accessToken || !imageUrl || !caption) {
    throw new Error('Missing required Instagram credentials or content fields (pageId, accessToken, imageUrl, caption).');
  }

  try {
    // Step 1: Create a media container (for image)
    const mediaContainerResponse = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/media`, {
      image_url: imageUrl,
      caption: caption,
      access_token: accessToken
    });
    const creationId = mediaContainerResponse.data.id;

    // Step 2: Publish the media
    const publishResponse = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/media_publish`, {
      creation_id: creationId,
      access_token: accessToken
    });
    
    console.log('Instagram Post published:', publishResponse.data);

    const igMediaId = publishResponse.data.id; // This is the IG Media ID

    // Step 3: Get the shortcode for the public URL
    const shortcodeResponse = await axios.get(`https://graph.facebook.com/v18.0/${igMediaId}?fields=shortcode&access_token=${accessToken}`);
    const shortcode = shortcodeResponse.data.shortcode;

    const postUrl = `https://www.instagram.com/p/${shortcode}/`; // Correct URL format

    return { success: true, postUrl: postUrl };
  } catch (error) {
    console.error('Error posting to Instagram:', error.response?.data || error.message);
    throw new Error(`Failed to post to Instagram: ${error.response?.data?.error?.message || error.message}`);
  }
} 