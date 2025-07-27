import OAuth from "oauth-1.0a";
import crypto from "crypto";
import axios from "axios";
import readline from "readline";

const consumerKey = "kDUQTqig34xv";
const consumerSecret = "u26NyXl1IEXY6msppeXddo7uBffEM5JK";
const callbackUrl = "http://localhost:3000/callback";

const requestTokenUrl = "https://www.plurk.com/OAuth/request_token";
const accessTokenUrl = "https://www.plurk.com/OAuth/access_token";
const authorizeUrl = "https://www.plurk.com/OAuth/authorize";

const oauth = new OAuth({
  consumer: { key: consumerKey, secret: consumerSecret },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

// 🔹 Terminal prompt utility
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function getRequestToken() {
  const request_data = {
    url: requestTokenUrl,
    method: "POST",
    data: { oauth_callback: callbackUrl },
  };

  const headers = oauth.toHeader(oauth.authorize(request_data));

  const res = await axios.post(requestTokenUrl, null, { headers });
  const params = new URLSearchParams(res.data);
  return {
    oauthToken: params.get("oauth_token"),
    oauthTokenSecret: params.get("oauth_token_secret"),
  };
}

async function getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier) {
  const access_data = {
    url: accessTokenUrl,
    method: "POST",
    data: { oauth_verifier: oauthVerifier },
  };

  const token = { key: oauthToken, secret: oauthTokenSecret };
  const headers = oauth.toHeader(oauth.authorize(access_data, token));

  const res = await axios.post(accessTokenUrl, null, { headers });
  const params = new URLSearchParams(res.data);
  return {
    accessToken: params.get("oauth_token"),
    accessTokenSecret: params.get("oauth_token_secret"),
  };
}

async function createPlurk(accessToken, accessTokenSecret) {
  const url = "https://www.plurk.com/APP/Timeline/plurkAdd";
  const data = {
    content: "This is a dummy plurk post!",
    qualifier: "says",
  };

  const request_data = {
    url: url,
    method: "POST",
    data: data,
  };

  const token = { key: accessToken, secret: accessTokenSecret };
  const headers = oauth.toHeader(oauth.authorize(request_data, token));
  headers["Content-Type"] = "application/x-www-form-urlencoded";

  try {
    const res = await axios.post(url, new URLSearchParams(data).toString(), {
      headers,
    });
    console.log("✅ Plurk created successfully:", res.data);
  } catch (err) {
    console.error("❌ Plurk POST Error:", err.response?.data || err.message);
  }
}

// -------------------------------
// ✅ MAIN FLOW
// -------------------------------
(async () => {
  try {
    const { oauthToken, oauthTokenSecret } = await getRequestToken();
    console.log("\n👉 Authorize here:", `${authorizeUrl}?oauth_token=${oauthToken}`);

    const verifier = await askQuestion("\nPaste the oauth_verifier here: ");

    const { accessToken, accessTokenSecret } = await getAccessToken(
      oauthToken,
      oauthTokenSecret,
      verifier
    );

    console.log("\n✅ Access Token:", accessToken);
    console.log("✅ Access Token Secret:", accessTokenSecret);

    await createPlurk(accessToken, accessTokenSecret);
  } catch (err) {
    console.error("\n❌ Error:", err.response?.data || err.message);
  }
})();


// 📝 Store the following credentials in your user API config to create Plurk posts later without re-auth:
// const consumerKey = "5JDKVjp0su1o";
// const consumerSecret = "AmB0PBUFNsAfgK86XgxTeAQjW38P7LqJ";
// const callbackUrl = "http://localhost:3000/callback";
// const accessToken = "<user_access_token>";
// const accessTokenSecret = "<user_access_token_secret>";
