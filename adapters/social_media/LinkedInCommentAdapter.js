// import BaseAdapter from "../BaseAdapter.js";
// import axios from "axios";
// import dbConnection from "../../utils/database.js"; // Assuming a merged project structure
// import LinkedInPost from "../../models/LinkedInPost.js"; // Now importing the model with categories
// import LinkedInComment from "../../models/LinkedInComment.js"; // The new model for comments

// class LinkedInCommentAdapter extends BaseAdapter {
//   constructor(jobDetails) {
//     super(jobDetails);
//     this.log(
//       "LinkedInCommentAdapter initialized with real API integration.",
//       "info",
//     );
//     this.llmApiUrl =
//       process.env.LLM_API || "http://31.97.229.2:3009/v1/chat/completions";
//     this.scrapingApiUrl = process.env.SCRAPING_API_URL; // URL for your scraping service
//   }

//   /**
//    * Main method to execute the comment publication logic.
//    */
//   async publish() {
//     this.log("Starting LinkedIn comment publication process.", "info", true);

//     try {
//       const { userId, campaignId } = this.job.data;
//       // Correctly destructure credentials based on the user's provided format
//       const { access_token: accessToken, linkedin_id } =
//         this.website.credentials;

//       if (!linkedin_id) {
//         throw new Error("linkedin_id is missing from credentials.");
//       }
//       const userUrn = `urn:li:person:${linkedin_id}`;

//       if (!userId || !accessToken || !userUrn) {
//         throw new Error(
//           "User ID, Access Token, and User URN are missing from job data/credentials.",
//         );
//       }

//       const category = await this.determineCategory();
//       this.log(`Determined content category: ${category}`, "info", true);

//       const latestPosts = await this.fetchLatestPosts(category);
//       if (latestPosts.length === 0) {
//         this.log(
//           `No posts found for category: ${category}. Nothing to comment on.`,
//           "warning",
//           true,
//         );
//         return {
//           success: true,
//           message: "No relevant posts found to comment on.",
//         };
//       }
//       this.log(
//         `Found ${latestPosts.length} posts for category '${category}'.`,
//         "info",
//         true,
//       );

//       for (const post of latestPosts) {
//         try {
//           const hasCommented = await this.hasUserCommented(
//             userId,
//             post.backend_urn,
//           );
//           if (hasCommented) {
//             this.log(
//               `User ${userId} has already commented on post ${post.backend_urn}. Skipping.`,
//               "detail",
//             );
//             continue;
//           }

//           const newLink = await this.fetchLinkForCategory(category);
//           if (!newLink) {
//             this.log(
//               `Could not fetch a relevant link for category ${category}. Skipping comment.`,
//               "warning",
//               true,
//             );
//             continue; // Skip if no link is found
//           }
//           const commentText = await this.generateComment(
//             userId,
//             category,
//             newLink,
//             post.post_text,
//           );
//           this.log(`Generated comment: "${commentText}"`, "info", true);

//           // Actually post the comment to LinkedIn
//           const apiResponse = await this.postCommentToLinkedIn(
//             accessToken,
//             userUrn,
//             post,
//             commentText,
//           );
//           const postUrl = `https://www.linkedin.com/feed/update/${post.backend_urn}/`;

//           await this.saveComment({
//             userId,
//             postId: post.backend_urn,
//             commentId:
//               apiResponse.id ||
//               `urn:li:comment:(${post.backend_urn},${Date.now()})`,
//             commentText,
//             category,
//             postedUrl: postUrl,
//           });

//           this.logPublicationSuccess(postUrl);
//           this.log(`Comment posted successfully to LinkedIn.`, "success", true);
//           this.log(`User ID: ${userId}`, "detail", true);
//           this.log(`Campaign ID: ${campaignId}`, "detail", true);

//           // If successful, exit the loop and return success
//           return {
//             success: true,
//             postUrl: postUrl,
//             metadata: {
//               comment: commentText,
//               userId: userId,
//               category: category,
//               commentedOnPostUrn: post.backend_urn,
//             },
//           };
//         } catch (error) {
//           // This is the skip-and-retry logic
//           if (error.isRetryable && error.correctUrn) {
//             this.log(
//               `URN mismatch detected. Retrying with correct URN: ${error.correctUrn}`,
//               "warning",
//               true,
//             );
//             try {
//               // Create a temporary post object with the correct URN for the retry
//               const correctedPost = { ...post, backend_urn: error.correctUrn };

//               // Second attempt with the correct URN
//               const retryResponse = await this.postCommentToLinkedIn(
//                 accessToken,
//                 userUrn,
//                 correctedPost,
//                 commentText,
//               );
//               const postUrl = `https://www.linkedin.com/feed/update/${correctedPost.backend_urn}/`;

//               await this.saveComment({
//                 userId,
//                 postId: correctedPost.backend_urn,
//                 commentId:
//                   retryResponse.id ||
//                   `urn:li:comment:(${correctedPost.backend_urn},${Date.now()})`,
//                 commentText,
//                 category,
//                 postedUrl: postUrl,
//               });

//               this.logPublicationSuccess(postUrl);
//               this.log(
//                 `Comment posted successfully on retry.`,
//                 "success",
//                 true,
//               );

//               return {
//                 success: true,
//                 postUrl: postUrl,
//                 metadata: {
//                   comment: commentText,
//                   userId: userId,
//                   category: category,
//                   commentedOnPostUrn: correctedPost.backend_urn,
//                 },
//               };
//             } catch (retryError) {
//               // If the retry fails, log it and let the loop continue to the next post
//               this.log(
//                 `Retry attempt failed for post ${post.backend_urn}: ${retryError.message}. Moving to next post.`,
//                 "error",
//                 true,
//               );
//               continue;
//             }
//           } else {
//             // For any other error, use the existing skip-and-retry logic
//             this.log(
//               `Failed to comment on post ${post.backend_urn}: ${error.message}. Retrying with next post.`,
//               "warning",
//               true,
//             );
//             continue; // Continue to the next post in the loop
//           }
//         }
//       }

//       this.log(
//         "No new posts to comment on after trying all available options.",
//         "info",
//         true,
//       );
//       return { success: true, message: "No new posts to comment on." };
//     } catch (error) {
//       this.log(
//         `LinkedIn comment publication failed: ${error.message}`,
//         "error",
//         true,
//       );
//       return this.handleError(error, null, null);
//     }
//   }

//   /**
//    * Posts a comment to a LinkedIn post using their V2 API.
//    * @param {string} accessToken - The user's OAuth2 access token.
//    * @param {string} userUrn - The user's LinkedIn URN.
//    * @param {object} post - The post object from the database.
//    * @param {string} commentText - The text of the comment.
//    * @returns {Promise<object>} The response data from the LinkedIn API.
//    */
//   async postCommentToLinkedIn(accessToken, userUrn, post, commentText) {
//     let postUrnForComment = post.backend_urn;

//     // Check if the share_url contains a groupPost URN and use it instead.
//     if (post.share_url && post.share_url.includes("urn:li:groupPost:")) {
//       const match = post.share_url.match(/(urn:li:groupPost:[^?&]+)/);
//       if (match && match[1]) {
//         postUrnForComment = match[1];
//         this.log(
//           `Group post detected. Using groupPost URN for commenting: ${postUrnForComment}`,
//           "info",
//           true,
//         );
//       }
//     }

//     this.log(
//       `Posting comment to LinkedIn post: ${postUrnForComment}`,
//       "detail",
//     );
//     const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrnForComment)}/comments`;

//     const data = {
//       actor: userUrn,
//       message: { text: commentText },
//     };

//     try {
//       const response = await axios.post(url, data, {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//           "Content-Type": "application/json",
//           "X-Restli-Protocol-Version": "2.0.0",
//         },
//       });
//       this.log("Successfully received response from LinkedIn API.", "detail");
//       return response.data;
//     } catch (error) {
//       const errorMessage = error.response?.data?.message || "";
//       const match = errorMessage.match(
//         /actual threadUrn: (urn:li:(?:ugcPost|groupPost):\d+)/,
//       );

//       if (match && match[1]) {
//         // This is the specific error we can retry.
//         const correctUrn = match[1];
//         const retryableError = new Error(
//           `URN mismatch. Correct URN is ${correctUrn}`,
//         );
//         retryableError.isRetryable = true;
//         retryableError.correctUrn = correctUrn;
//         throw retryableError; // Throw the custom error
//       }

//       // For all other errors, throw the original formatted error
//       const genericErrorMessage = error.response?.data || error.message;
//       this.log(
//         `Failed to post comment to LinkedIn: ${JSON.stringify(genericErrorMessage)}`,
//         "error",
//         true,
//       );
//       throw new Error(
//         `LinkedIn API Error: ${JSON.stringify(genericErrorMessage)}`,
//       );
//     }
//   }

//   async fetchLatestPosts(category) {
//     this.log(`Fetching latest posts for category: ${category}`, "detail");
//     return await LinkedInPost.find({ category: category })
//       .sort({ posted_at: -1 })
//       .limit(10)
//       .lean();
//   }

//   async hasUserCommented(userId, postId) {
//     const existingComment = await LinkedInComment.findOne({
//       userId,
//       postId,
//     }).lean();
//     return !!existingComment;
//   }

//   async saveComment(commentData) {
//     this.log(
//       `Saving comment to database for post ${commentData.postId}`,
//       "detail",
//     );
//     const newComment = new LinkedInComment(commentData);
//     await newComment.save();
//     this.log("Comment saved successfully.", "success", true);
//   }

//   /**
//    * Build a detailed prompt for the LLM based on user and business context.
//    * @returns {string} The comprehensive prompt.
//    */
//   buildCategoryPrompt() {
//     const jobData = this.job?.data || {};
//     const userInfo = jobData?.content?.info?.user || {};
//     const businessInfo = jobData?.content?.info || {};
//     const content = jobData?.content || {};

//     let prompt = "";

//     if (userInfo.first_name) {
//       prompt += `I am ${userInfo.first_name}, `;
//     }
//     if (userInfo.designation) {
//       prompt += `working as a ${userInfo.designation}. `;
//     }
//     if (
//       userInfo.business_categories &&
//       userInfo.business_categories.length > 0
//     ) {
//       prompt += `My business specializes in ${userInfo.business_categories.join(", ")}. `;
//     }
//     if (userInfo.company_website) {
//       prompt += `My main business website is ${userInfo.company_website}. `;
//     }
//     if (userInfo.about_business_description) {
//       prompt += `About my business: ${userInfo.about_business_description}. `;
//     }
//     if (userInfo.target_keywords) {
//       prompt += `Key topics I focus on: ${userInfo.target_keywords}. `;
//     }
//     if (content.title && content.title !== "Untitled") {
//       prompt += `I am creating content with the title: "${content.title}". `;
//     }
//     if (content.body) {
//       const contentText = content.body.substring(0, 200);
//       prompt += `The content is about: ${contentText}... `;
//     }

//     prompt +=
//       "Based on all this information, please determine the most appropriate category for this content.";

//     return prompt;
//   }

//   async determineCategory() {
//     this.log(
//       "Calling LLM to determine category from predefined list...",
//       "detail",
//     );

//     const validCategories = Object.values(LinkedInPost.CATEGORIES);
//     const categoryList = validCategories.join(", ");

//     // Use the new detailed prompt builder
//     const detailedPrompt = this.buildCategoryPrompt();

//     const userPrompt = `${detailedPrompt}\n\nFrom the following list of categories, select the single most relevant one.\n\nCategories: [${categoryList}]\n\nProvide only the single category name as your answer.`;
//     this.log(`Generated LLM Prompt Context: ${userPrompt}`, "detail");
//     try {
//       // const response = await axios.post(
//       //   this.llmApiUrl,
//       //   {
//       //     model: "Meta-Llama-3.1-8B-Instruct.Q6_K.gguf",
//       //     temperature: 0.2,
//       //     // max_tokens: 20,
//       //     messages: [{ role: "user", content: finalPrompt }],
//       //   },
//       //   { headers: { "Content-Type": "application/json" } },
//       // );

//       const response = await axios.post(
//         "http://31.97.229.2:3010/v1/chat/completions",
//         {
//           model: "phi3:mini",
//           temperature: 0.7,
//           max_tokens: 120,
//           messages: [
//             {
//               role: "system",
//               content:
//                 "**ROLE**: You are a classification expert focused on assigning content to categories. You are NOT a chatbot, explainer, or general assistant. Your task is to confidently select a category from a predefined list.\n\n**GOAL**: From the provided list of categories, choose the ONE that best matches the topic or content. Only one answer is allowed — the most relevant and specific match.\n\n**OUTPUT**: Only return the exact name of the selected category — no descriptions, comments, markdown, or explanations. Do NOT echo the prompt or list.\n\n**LEVEL OF DETAIL**: Make a clear, decisive choice based on content meaning. Avoid broad or vague matches. Prioritize specificity and relevance.\n\n**DELIVER TO**: A backend system expecting clean, structured data. Output must be a single category string that maps directly to the list provided.",
//             },
//             { role: "user", content: userPrompt },
//           ],
//         },
//         { headers: { "Content-Type": "application/json" } },
//       );

//       const llmResponseText =
//         response.data.choices[0].message.content.toLowerCase();
//       this.log(`LLM raw response (lowercase): "${llmResponseText}"`, "detail");

//       const responseText = String(llmResponseText).toLowerCase().trim();

//       for (const category of validCategories) {
//         const pattern = new RegExp(`^${category}$`, "i"); // Exact match, case-insensitive

//         if (pattern.test(responseText)) {
//           this.log(
//             `Matched category "${category}" from LLM response.`,
//             "detail",
//           );
//           return category;
//         }
//       }

//       this.log(
//         `Could not match any valid category from LLM response. Falling back to uncategorized.`,
//         "warning",
//         true,
//       );
//       return LinkedInPost.CATEGORIES.UNCATEGORIZED;
//     } catch (error) {
//       this.log(
//         `LLM API call for category determination failed: ${error.message}`,
//         "warning",
//         true,
//       );
//       return LinkedInPost.CATEGORIES.UNCATEGORIZED;
//     }
//   }

//   async fetchLinkForCategory(category) {
//     if (!this.scrapingApiUrl) {
//       this.log(
//         "SCRAPING_API_URL is not set in .env. Skipping link fetch.",
//         "warning",
//         true,
//       );
//       return "https://example.com/default-link";
//     }

//     this.log(
//       `Fetching a new link for the "${category}" category from ${this.scrapingApiUrl}`,
//       "detail",
//     );

//     try {
//       const url = `${this.scrapingApiUrl}/posts?category=${category}&limit=1&sortBy=posted_at&sortOrder=-1`;

//       // Log the username for debugging the 401 error
//       const username = process.env.AUTH_USERNAME;
//       this.log(
//         `Using AUTH_USERNAME: ${username} for scraping API call.`,
//         "detail",
//       );

//       const auth =
//         "Basic " +
//         Buffer.from(`${username}:${process.env.AUTH_PASSWORD}`).toString(
//           "base64",
//         );

//       const response = await axios.get(url, {
//         headers: { Authorization: auth },
//       });

//       if (response.data?.data?.length > 0) {
//         const post = response.data.data[0];
//         this.log(`Found relevant link: ${post.share_url}`, "detail");
//         return post.share_url;
//       } else {
//         this.log(
//           `No posts found for category "${category}" in the scraping database.`,
//           "warning",
//           true,
//         );
//         return null;
//       }
//     } catch (error) {
//       this.log(
//         `Failed to fetch link from scraping API: ${error.message}`,
//         "error",
//         true,
//       );
//       return null;
//     }
//   }

//   async generateComment(userId, category, link, postText) {
//     this.log(
//       `Calling LLM to generate a human-like comment for user ${userId}...`,
//       "detail",
//     );

//     const systemPrompt = `**ROLE**: You are a real human professional on LinkedIn. You are NOT a bot, assistant, academic, or summarizer. You are a busy, thoughtful person who leaves short, smart comments under posts.\n\n**GOAL**: Write a realistic, 2–3 sentence comment that adds genuine value to a LinkedIn conversation. The tone should be professional but natural — as if you were quickly replying on your phone during a coffee break.\n\n**OUTPUT**: Only output the comment — no instructions, summaries, hashtags, links, or markdown. Do NOT explain. Do NOT repeat the post. Do NOT use emojis unless completely natural. Do NOT copy this prompt. Your output must:\n- Be SHORT (max 3 sentences)\n- Feel NATURAL, like a real person wrote it\n- React to the *ideas* in the post, not the formatting\n\n**LEVEL OF DETAIL**: Be thoughtful but brief. One sharp idea is better than a mini-essay. Avoid clichés like “Thanks for sharing” or “Great insights.” Use plain language that shows awareness and relevance.\n\n**DELIVER TO**: The LinkedIn comment section, where professionals skim quickly. Your words should make someone pause — not scroll.`;

//     const userPrompt = `${postText.substring(0, 1000)}..."\n\nPlease write a comment that adds genuine value to the conversation.`;

//     try {
//       const response = await axios.post(
//         "http://31.97.229.2:3010/v1/chat/completions",
//         {
//           model: "phi3:mini",
//           temperature: 0.7,
//           max_tokens: 120,
//           messages: [
//             { role: "system", content: systemPrompt },
//             { role: "user", content: userPrompt },
//           ],
//         },
//         { headers: { "Content-Type": "application/json" } },
//       );

//       const comment = response.data.choices[0].message.content
//         .trim()
//         .replace(/^"|"$/g, ""); // Remove wrapping quotes
//       return (
//         comment ||
//         `This is a great point on ${category}. I found a related resource that adds to the discussion: ${link}`
//       );
//     } catch (error) {
//       this.log(
//         `LLM API call for comment generation failed: ${error.message}`,
//         "warning",
//         true,
//       );
//       return `This is a great point on ${category}. I found a related resource that adds to the discussion: ${link}`;
//     }
//   }
// }

// export default LinkedInCommentAdapter;

import BaseAdapter from "../BaseAdapter.js";
import axios from "axios";
import Redis from "ioredis";
import dbConnection from "../../utils/database.js"; // Assuming a merged project structure
import LinkedInPost from "../../models/LinkedInPost.js"; // Now importing the model with categories
import LinkedInComment from "../../models/LinkedInComment.js"; // The new model for comments

class LinkedInCommentAdapter extends BaseAdapter {
  constructor(jobDetails) {
    super(jobDetails);
    this.log(
      "LinkedInCommentAdapter initialized with real API integration.",
      "info",
    );
    this.llmApiUrl =
      process.env.LLM_API || "http://31.97.229.2:3010/v1/chat/completions";
    this.scrapingApiUrl = process.env.SCRAPING_API_URL; // URL for your scraping service

    // Redis client for lightweight locks to avoid double-commenting the same post concurrently
    const redisProtocol = process.env.REDIS_PROTOCOL || "redis://";
    const host = process.env.PUBLISH_REDIS_HOST || process.env.REDIS_HOST || "redis";
    const port = process.env.PUBLISH_REDIS_PORT || process.env.REDIS_PORT || 6379;
    const password = process.env.PUBLISH_REDIS_PASSWORD || process.env.REDIS_PASSWORD;
    const redisUrl = password
      ? `${redisProtocol}:${encodeURIComponent(password)}@${host}:${port}`
      : `${redisProtocol}${host}:${port}`;
    this.redis = new Redis(redisUrl);
    this.locks = new Map();
  }

  /**
   * Lightweight Redis lock helpers
   */
  async acquireLock(key, ttlSeconds = 120) {
    try {
      const result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch {
      return false;
    }
  }

  async releaseLock(key) {
    try { await this.redis.del(key); } catch {}
  }

  /**
   * Main method to execute the comment publication logic.
   */
  async publish() {
    this.log("Starting LinkedIn comment publication process.", "info", true);

    try {
      const { userId, campaignId } = this.job.data;
      // Correctly destructure credentials based on the user's provided format
      const { access_token: accessToken, linkedin_id } =
        this.website.credentials;

      if (!linkedin_id) {
        throw new Error("linkedin_id is missing from credentials.");
      }
      const userUrn = `urn:li:person:${linkedin_id}`;

      if (!userId || !accessToken || !userUrn) {
        throw new Error(
          "User ID, Access Token, and User URN are missing from job data/credentials.",
        );
      }

      const category = await this.determineCategory();
      this.log(`Determined content category: ${category}`, "info", true);

      // Do not auto-comment on uncategorized; treat as error to avoid spammy fallbacks
      if (String(category).toLowerCase() === 'uncategorized') {
        const e = new Error('Cannot auto-comment for uncategorized content');
        e.isFatal = true;
        throw e;
      }

      const latestPosts = await this.fetchLatestPosts(category);
      if (latestPosts.length === 0) {
        const e = new Error(`No posts found for category: ${category}. Nothing to comment on.`);
        e.isFatal = true;
        throw e;
      }
      this.log(
        `Found ${latestPosts.length} posts for category '${category}'.`,
        "info",
        true,
      );

      const perJobLimit = Number(this.job?.data?.perJobLimit) || 1;
      let successCount = 0;

      for (const post of latestPosts) {
        let commentText = ""; // Declare commentText here to be available in the catch block
        // Lock key per user/post-urn to avoid concurrent duplicate comments
        const lockKey = `li_comment_lock:${userId}:${post.backend_urn}`;
        try {
          const hasCommented = await this.hasUserCommented(
            userId,
            post.backend_urn,
          );
          if (hasCommented) {
            this.log(
              `User ${userId} has already commented on post ${post.backend_urn}. Skipping.`,
              "detail",
            );
            continue;
          }

          // Acquire a short-lived lock to prevent two concurrent jobs from picking the same post
          const gotLock = await this.acquireLock(lockKey, 120);
          if (!gotLock) {
            this.log(`Post ${post.backend_urn} is locked by another job. Skipping.`, "detail");
            continue;
          }

          // Extra duplicate safety: if already commented on any equivalent URN or URL, skip
          const candidateUrns = [post.backend_urn];
          if (post.share_url) {
            const m = post.share_url.match(/urn:li:(?:ugcPost|groupPost|activity):\d+/);
            if (m && !candidateUrns.includes(m[0])) candidateUrns.push(m[0]);
          }
          if (await this.hasUserCommentedByAnyUrn(userId, candidateUrns)) {
            this.log(`Already commented on equivalent URN for post ${post.backend_urn}. Skipping.`, "detail");
            await this.releaseLock(lockKey);
            continue;
          }
          const primaryUrl = `https://www.linkedin.com/feed/update/${post.backend_urn}/`;
          if (await this.hasUserCommentedByUrl(userId, primaryUrl) || (post.share_url && await this.hasUserCommentedByUrl(userId, post.share_url))) {
            this.log(`Already commented on same URL for post ${post.backend_urn}. Skipping.`, "detail");
            await this.releaseLock(lockKey);
            continue;
          }

          const newLink = await this.fetchLinkForCategory(category);
          if (!newLink) {
            this.log(
              `Could not fetch a relevant link for category ${category}. Skipping comment.`,
              "warning",
              true,
            );
            await this.releaseLock(lockKey);
            continue; // Skip if no link is found
          }

          // Assign the generated comment to the loop-scoped variable
          commentText = await this.generateComment(
            userId,
            category,
            newLink,
            post.post_text,
          );
          this.log(`Generated comment: "${commentText}"`, "info", true);

          // Actually post the comment to LinkedIn
          const apiResponse = await this.postCommentToLinkedIn(
            accessToken,
            userUrn,
            post,
            commentText,
          );
          const postUrl = `https://www.linkedin.com/feed/update/${post.backend_urn}/`;

          await this.saveComment({
            userId,
            postId: post.backend_urn,
            commentId:
              apiResponse.id ||
              `urn:li:comment:(${post.backend_urn},${Date.now()})`,
            commentText,
            category,
            postedUrl: postUrl,
          });

          // Log the exact comment URL for traceability
          const commentUrl = apiResponse.id
            ? `https://www.linkedin.com/feed/update/${post.backend_urn}/?commentUrn=urn:li:comment:${apiResponse.id}`
            : postUrl;
          this.logPublicationSuccess(commentUrl);
          this.log(`Comment posted successfully to LinkedIn.`, "success", true);
          this.log(`User ID: ${userId}`, "detail", true);
          this.log(`Campaign ID: ${campaignId}`, "detail", true);

          successCount += 1;
          await this.releaseLock(lockKey);
          // Return success for this job (perJobLimit is 1 for linked_comment)
          return {
            success: true,
            postUrl: postUrl,
            metadata: {
              comment: commentText,
              userId: userId,
              category: category,
              commentedOnPostUrn: post.backend_urn,
            },
          };
        } catch (error) {
          // This is the skip-and-retry logic
          if (error.isRetryable && error.correctUrn) {
            this.log(
              `URN mismatch detected. Retrying with correct URN: ${error.correctUrn}`,
              "warning",
              true,
            );
            try {
              // Create a temporary post object with the correct URN for the retry
              const correctedPost = { ...post, backend_urn: error.correctUrn };

              // Second attempt with the correct URN
              const retryResponse = await this.postCommentToLinkedIn(
                accessToken,
                userUrn,
                correctedPost,
                commentText,
              ); // Use commentText from the outer scope
              const postUrl = `https://www.linkedin.com/feed/update/${correctedPost.backend_urn}/`;

              await this.saveComment({
                userId,
                postId: correctedPost.backend_urn,
                commentId:
                  retryResponse.id ||
                  `urn:li:comment:(${correctedPost.backend_urn},${Date.now()})`,
                commentText,
                category,
                postedUrl: postUrl,
              });

              // Log exact comment URL on retry
              const commentUrl2 = retryResponse.id
                ? `https://www.linkedin.com/feed/update/${correctedPost.backend_urn}/?commentUrn=urn:li:comment:${retryResponse.id}`
                : postUrl;
              this.logPublicationSuccess(commentUrl2);
              this.log(
                `Comment posted successfully on retry.`,
                "success",
                true,
              );

              successCount += 1;
              await this.releaseLock(lockKey);
              return {
                success: true,
                postUrl: postUrl,
                metadata: {
                  comment: commentText,
                  userId: userId,
                  category: category,
                  commentedOnPostUrn: correctedPost.backend_urn,
                },
              };
            } catch (retryError) {
              // If the retry fails, log it and let the loop continue to the next post
              this.log(
                `Retry attempt failed for post ${post.backend_urn}: ${retryError.message}. Moving to next post.`,
                "error",
                true,
              );
              await this.releaseLock(lockKey);
              continue;
            }
          } else {
            // If generateComment or other fatal path signaled a fatal error, bubble up to worker (error tab)
            if (error && error.isFatal) {
              throw error;
            }
            // For any other error, use the existing skip-and-retry logic
            this.log(
              `Failed to comment on post ${post.backend_urn}: ${error.message}. Retrying with next post.`,
              "warning",
              true,
            );
            await this.releaseLock(lockKey);
            continue; // Continue to the next post in the loop
          }
        }
      }

      if (successCount > 0) {
        this.log(
          `Completed commenting on ${successCount} post(s) for category '${category}'.`,
          "success",
          true,
        );
        return {
          success: true,
          postUrl: lastPostUrl,
          metadata: { successCount, category },
        };
      }
      this.log(
        "No new posts to comment on after trying all available options.",
        "info",
        true,
      );
      return { success: false, error: "No eligible posts to comment on." };
    } catch (error) {
      this.log(
        `LinkedIn comment publication failed: ${error.message}`,
        "error",
        true,
      );
      return this.handleError(error, null, null);
    }
  }

  /**
   * Posts a comment to a LinkedIn post using their V2 API.
   * @param {string} accessToken - The user's OAuth2 access token.
   * @param {string} userUrn - The user's LinkedIn URN.
   * @param {object} post - The post object from the database.
   * @param {string} commentText - The text of the comment.
   * @returns {Promise<object>} The response data from the LinkedIn API.
   */
  async postCommentToLinkedIn(accessToken, userUrn, post, commentText) {
    let postUrnForComment = post.backend_urn;

    // Check if the share_url contains a groupPost URN and use it instead.
    if (post.share_url && post.share_url.includes("urn:li:groupPost:")) {
      const match = post.share_url.match(/(urn:li:groupPost:[^?&]+)/);
      if (match && match[1]) {
        postUrnForComment = match[1];
        this.log(
          `Group post detected. Using groupPost URN for commenting: ${postUrnForComment}`,
          "info",
          true,
        );
      }
    }

    this.log(
      `Posting comment to LinkedIn post: ${postUrnForComment}`,
      "detail",
    );
    const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrnForComment)}/comments`;

    const data = {
      actor: userUrn,
      message: { text: commentText },
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });
      this.log("Successfully received response from LinkedIn API.", "detail");
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || "";
      const match = errorMessage.match(
        /actual threadUrn: (urn:li:(?:ugcPost|groupPost):\d+)/,
      );

      if (match && match[1]) {
        // This is the specific error we can retry.
        const correctUrn = match[1];
        const retryableError = new Error(
          `URN mismatch. Correct URN is ${correctUrn}`,
        );
        retryableError.isRetryable = true;
        retryableError.correctUrn = correctUrn;
        throw retryableError; // Throw the custom error
      }

      // For all other errors, throw the original formatted error
      const genericErrorMessage = error.response?.data || error.message || error;
      this.log(
        `Failed to post comment to LinkedIn: ${JSON.stringify(genericErrorMessage)}`,
        "error",
        true,
      );
      throw new Error(
        `LinkedIn API Error: ${JSON.stringify(genericErrorMessage)}`,
      );
    }
  }

  getMinIncludeFromJob(defaultLimit = 10) {
    try {
      const sites = this.job?.data?.info?.sites_details;
      if (!Array.isArray(sites)) return defaultLimit;
      // Find entry matching this website's parent category (social_media) or exact category
      const wanted = sites.find((s) => {
        const cat = (s.category || '').toLowerCase();
        const myCat = (this.website?.category || '').toLowerCase();
        return cat === myCat || (myCat.includes('social_media') && cat === 'social_media');
      });
      if (!wanted) return defaultLimit;
      // Support multiple keys: minimumInclude | minInclude | minPosts
      const raw = wanted.hasOwnProperty('minimumInclude') ? wanted.minimumInclude
                 : wanted.hasOwnProperty('minInclude') ? wanted.minInclude
                 : wanted.hasOwnProperty('minPosts') ? wanted.minPosts
                 : undefined;
      // null/undefined => unlimited
      if (raw === null || typeof raw === 'undefined') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : defaultLimit;
    } catch {
      return defaultLimit;
    }
  }

  async fetchLatestPosts(category) {
    this.log(`Fetching latest posts for category: ${category}`, "detail");
    const limit = this.getMinIncludeFromJob(10);
    let q = LinkedInPost.find({ category: category }).sort({ posted_at: -1 });
    if (limit !== null) q = q.limit(limit);
    return await q.lean();
  }

  async hasUserCommented(userId, postId) {
    const existingComment = await LinkedInComment.findOne({ userId, postId }).lean();
    return !!existingComment;
  }

  async hasUserCommentedByUrl(userId, postedUrl) {
    if (!postedUrl) return false;
    const existing = await LinkedInComment.findOne({ userId, postedUrl }).lean();
    return !!existing;
  }

  async hasUserCommentedByAnyUrn(userId, urns = []) {
    if (!Array.isArray(urns) || urns.length === 0) return false;
    const existing = await LinkedInComment.findOne({ userId, postId: { $in: urns } }).lean();
    return !!existing;
  }

  async saveComment(commentData) {
    this.log(
      `Saving comment to database for post ${commentData.postId}`,
      "detail",
    );
    const newComment = new LinkedInComment(commentData);
    await newComment.save();
    this.log("Comment saved successfully.", "success", true);
  }

  /**
   * Build a detailed prompt for the LLM based on user and business context.
   * @returns {string} The comprehensive prompt.
   */
  buildCategoryPrompt() {
    const jobData = this.job?.data || {};
    const userInfo = jobData?.content?.info?.user || {};
    const businessInfo = jobData?.content?.info || {};
    const content = jobData?.content || {};

    let prompt = "";

    if (userInfo.first_name) {
      prompt += `I am ${userInfo.first_name}, `;
    }
    if (userInfo.designation) {
      prompt += `working as a ${userInfo.designation}. `;
    }
    if (
      userInfo.business_categories &&
      userInfo.business_categories.length > 0
    ) {
      prompt += `My business specializes in ${userInfo.business_categories.join(", ")}. `;
    }
    if (userInfo.company_website) {
      prompt += `My main business website is ${userInfo.company_website}. `;
    }
    if (userInfo.about_business_description) {
      prompt += `About my business: ${userInfo.about_business_description}. `;
    }
    if (userInfo.target_keywords) {
      prompt += `Key topics I focus on: ${userInfo.target_keywords}. `;
    }
    if (content.title && content.title !== "Untitled") {
      prompt += `I am creating content with the title: "${content.title}". `;
    }
    if (content.body) {
      const contentText = content.body.substring(0, 200);
      prompt += `The content is about: ${contentText}... `;
    }

    prompt +=
      "Based on all this information, please determine the most appropriate category for this content.";

    return prompt;
  }

  async determineCategory() {
    this.log(
      "Calling LLM to determine category from predefined list...",
      "detail",
    );

    const validCategories = Object.values(LinkedInPost.CATEGORIES);
    const categoryList = validCategories.join(", ");

    // Use the new detailed prompt builder
    const detailedPrompt = this.buildCategoryPrompt();

    const userPrompt = `${detailedPrompt}\n\nFrom the following list of categories, select the single most relevant one.\n\nCategories: [${categoryList}]\n\nProvide only the single category name as your answer.`;
    this.log(`Generated LLM Prompt Context: ${userPrompt}`, "detail");
    try {
      const response = await axios.post(
        this.llmApiUrl,
        {
          model: "phi3:mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `You are a classification expert. Your goal is to choose the single best category from a predefined list for the given content. Output ONLY the category name, exactly as it appears in the list (e.g., 'technical_tutorial'). Do not add any other text. Categories: [${categoryList}]`,
            },
            { role: "user", content: userPrompt },
          ],
        },
        { headers: { "Content-Type": "application/json" } },
      );

      const llmResponseText =
        response.data.choices[0].message.content.toLowerCase();
      this.log(`LLM raw response (lowercase): "${llmResponseText}"`, "detail");

      const responseText = String(llmResponseText).toLowerCase().trim();

      for (const category of validCategories) {
        const pattern = new RegExp(`^${category}$`, "i"); // Exact match, case-insensitive

        if (pattern.test(responseText)) {
          this.log(
            `Matched category "${category}" from LLM response.`,
            "detail",
          );
          return category;
        }
      }

      this.log(
        `Could not match any valid category from LLM response. Falling back to uncategorized.`,
        "warning",
        true,
      );
      return LinkedInPost.CATEGORIES.UNCATEGORIZED;
    } catch (error) {
      this.log(
        `LLM API call for category determination failed: ${error.message}`,
        "warning",
        true,
      );
      return LinkedInPost.CATEGORIES.UNCATEGORIZED;
    }
  }

  async fetchLinkForCategory(category) {
    if (!this.scrapingApiUrl) {
      this.log(
        "SCRAPING_API_URL is not set in .env. Cannot fetch link.",
        "error",
        true,
      );
      return null;
    }

    this.log(
      `Fetching a new link for the "${category}" category from ${this.scrapingApiUrl}`,
      "detail",
    );

    try {
      const url = `${this.scrapingApiUrl}/posts?category=${category}&limit=1&sortBy=posted_at&sortOrder=-1`;

      // Log the username for debugging the 401 error
      const username = process.env.AUTH_USERNAME;
      this.log(
        `Using AUTH_USERNAME: ${username} for scraping API call.`,
        "detail",
      );

      const auth =
        "Basic " +
        Buffer.from(`${username}:${process.env.AUTH_PASSWORD}`).toString(
          "base64",
        );

      const response = await axios.get(url, {
        headers: { Authorization: auth },
      });

      if (response.data?.data?.length > 0) {
        const post = response.data.data[0];
        const share = (post.share_url && post.share_url.trim().length)
          ? post.share_url
          : (post.backend_urn && post.backend_urn.startsWith('urn:li:')
              ? `https://www.linkedin.com/feed/update/${post.backend_urn}/`
              : null);
        if (!share) {
          this.log(`Found relevant post without usable link/urn for category "${category}"`, "error", true);
          return null;
        }
        this.log(`Found relevant link: ${share}`, "detail");
        return share;
      } else {
        this.log(
          `No posts found for category "${category}" in the scraping database.`,
          "warning",
          true,
        );
        return null;
      }
    } catch (error) {
      this.log(
        `Failed to fetch link from scraping API: ${error.message}`,
        "error",
        true,
      );
      return null;
    }
  }

  async generateComment(userId, category, link, postText) {
    this.log(
      `Calling LLM to generate a human-like comment for user ${userId}...`,
      "detail",
    );

    const systemPrompt = `**ROLE**: You are a real human professional on LinkedIn. You are NOT a bot, assistant, academic, or summarizer. You are a busy, thoughtful person who leaves short, smart comments under posts.\n\n**GOAL**: Write a realistic, 2–3 sentence comment that adds genuine value to a LinkedIn conversation. The tone should be professional but natural — as if you were quickly replying on your phone during a coffee break.\n\n**OUTPUT**: Only output the comment — no instructions, summaries, hashtags, links, or markdown. Do NOT explain. Do NOT repeat the post. Do NOT use emojis unless completely natural. Do NOT copy this prompt. Your output must:\n- Be SHORT (max 3 sentences)\n- Feel NATURAL, like a real person wrote it\n- React to the *ideas* in the post, not the formatting\n\n**LEVEL OF DETAIL**: Be thoughtful but brief. One sharp idea is better than a mini-essay. Avoid clichés like “Thanks for sharing” or “Great insights.” Use plain language that shows awareness and relevance.\n\n**DELIVER TO**: The LinkedIn comment section, where professionals skim quickly. Your words should make someone pause — not scroll.`;

    const userPrompt = `Here is the post content:\n\"${postText.substring(0, 1000)}...\"\n\nPlease write a comment that adds genuine value to the conversation.`;

    try {
      const response = await axios.post(
        this.llmApiUrl,
        {
          model: "phi3:mini",
          temperature: 0.7,
          max_tokens: 120,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        { headers: { "Content-Type": "application/json" } },
      );

      const comment = response.data.choices[0].message.content
        .trim()
        .replace(/^"|"$/g, ""); // Remove wrapping quotes
      return comment;
    } catch (error) {
      this.log(
        `LLM API call for comment generation failed: ${error.message}`,
        "error",
        true,
      );
      throw error; // Bubble up so caller can save to error tab
    }
  }
}

export default LinkedInCommentAdapter;
