import { TwitterApi } from 'twitter-api-v2';

const getTwitterClient = (appKey, appSecret, accessToken, accessSecret) => {
  const client = new TwitterApi({
    appKey: appKey,
    appSecret: appSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });
  return client.readWrite;
};

export async function sendTweet(credentials, tweetText) {
  try {
    const twitterClient = getTwitterClient(credentials.appKey, credentials.appSecret, credentials.accessToken, credentials.accessSecret);
    console.log("Sending tweet...");
    const { data } = await twitterClient.v2.tweet(tweetText);
    console.log("Tweet posted:", data);
    // Construct the tweet URL. This might require more robust logic depending on Twitter's API response structure.
    // For v2.tweet, the ID is in data.id, and the username might be in credentials or retrieved separately.
    // A common URL format is https://twitter.com/USERNAME/status/TWEET_ID
    // For now, let's return a placeholder or the ID if username is not readily available.
    const tweetUrl = `https://twitter.com/i/status/${data.id}`;
    return { success: true, tweetUrl: tweetUrl };
  } catch (error) {
    console.error("Error posting tweet:", error);
    return { success: false, error: error.message };
  }
} 