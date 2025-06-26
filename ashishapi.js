// import { ArticlePostModel } from '../models/articlePost.model';
// import { CreateArticlePostDto, ArticlePost, ApiKey } from '../types/article.types';
// import { ArticleService } from './article.service';
// import { ApiKeyService } from './apiKey.service';
// import { UserActivityLogService } from './userActivityLog.service';
// import { SocialMediaApiClient } from '../utils/SocialMediaApiClient';
// import { WebsiteService } from './website.service';
// import { Article } from '../types/article.types';
// import * as UserService from './userService';
// import * as SubscriptionModel from '../models/subscription.model';
// import * as PackageModel from '../models/subscriptionPackage.model';


// export class ArticlePostService {

//   static async postArticle(dto: CreateArticlePostDto, userId: number, companyId?: number | null): Promise<ArticlePost> {
//     const activeSubscription = await SubscriptionModel.findActiveSubscriptionByUserId(userId);
//     if (activeSubscription) {
//       const { article } = await this.validateArticleAndApiKeys(dto, userId, companyId);
//       const subscriptionPackage = await PackageModel.findPackageById(activeSubscription.package_id);

//       if (subscriptionPackage) {
//         // Get all websites categorized as 'article'
//         const websitesByCategory = (await WebsiteService.getWebsitesByCategory('article', 100, 0)).data;
//         const apiKeysForWebsites = await ApiKeyService.getApiKeysByWebsiteIdsAndUserId(websitesByCategory.map(w => w.id), userId);

//         // api keys with website names
//         const apiKeysWithWebsiteNames = apiKeysForWebsites.map(apiKey => {
//           const website = websitesByCategory.find(w => w.id === apiKey.website_id);
//           return {
//             ...apiKey,
//             websiteName: website ? website.name : 'Unknown',
//           };
//         });
//         const dynamicCredentials: { [key: string]: any } = {};

//         apiKeysWithWebsiteNames.forEach(apiKey => {
//           const lowerCaseWebsiteName = apiKey.websiteName.toLowerCase();
//           if (!apiKey.credentials) return;

//           if (lowerCaseWebsiteName.includes('tumblr')) {
//             dynamicCredentials.tumblr = {
//               hostname: apiKey.credentials.hostname,
//               consumer_key: apiKey.credentials.consumer_key,
//               consumer_secret: apiKey.credentials.consumer_secret,
//               token: apiKey.credentials.token,
//               tokenSecret: apiKey.credentials.secret_key,
//             };
//           } else if (lowerCaseWebsiteName.includes('dev.to')) {
//             dynamicCredentials.devto = {
//               apiKey: apiKey.credentials.api_key,
//             };
//           } else if (lowerCaseWebsiteName.includes('hashnode')) {
//             dynamicCredentials.hashnode = {
//               apiKey: apiKey.credentials.api_key,
//               username: apiKey.credentials.username,
//             };
//           } else if (lowerCaseWebsiteName.includes('reddit')) {
//             dynamicCredentials.reddit = {
//               clientId: apiKey.credentials.client_id,
//               clientSecret: apiKey.credentials.client_secret,
//               username: apiKey.credentials.username,
//               password: apiKey.credentials.password,
//               subreddit: apiKey.credentials.subreddit, // Extract subreddit from credentials
//             };
//           }
//         });
//         const socialMediaClient = new SocialMediaApiClient(dynamicCredentials);
//         console.log("socialMediaClient", socialMediaClient);
//         // Create the article post entry in DB *before* posting to social media
//         const articlePost = await ArticlePostModel.create(dto);
//         console.log("dynamicCredentials", dynamicCredentials);
//         try {
//           const { devtoPost, hashnodePost, tumblrPostUrl, redditPostUrl } = await this.createSocialMediaPosts(article, socialMediaClient, dynamicCredentials);
//           console.log("result", devtoPost);

//           const postUrls = [devtoPost, hashnodePost, tumblrPostUrl, redditPostUrl].filter(url => url) as string[];
//           const updatedPost = await this.handlePostSuccess(article, dto, userId, articlePost, postUrls);
//           return updatedPost!;
//         } catch (error) {
//           await this.handlePostFailure(article, dto, userId, articlePost, error);
//           throw error;
//         }

//       } else {
//         throw new Error('Subscription package not found.');
//       }
//     } else {
//       throw new Error('No active subscription found for the user.');
//     }
//   }

//   private static async validateArticleAndApiKeys(dto: CreateArticlePostDto, userId: number, companyId?: number | null) {
//     const article = await ArticleService.getArticleById(dto.article_id, userId, companyId);
//     if (!article) {
//       throw new Error('Article not found or access denied.');
//     }

//     if (!dto.api_key_ids || dto.api_key_ids.length === 0) {
//       throw new Error('At least one API key must be selected.');
//     }

//     const userForAuth = await UserService.getUserProfileService(userId);
//     if (!userForAuth) {
//       throw new Error('User performing the action not found.');
//     }


//     return { article };
//   }

//   private static async createSocialMediaPosts(article: Article, socialMediaClient: SocialMediaApiClient, dynamicCredentials: { [key: string]: any }) {
//     let tumblrPost: any;
//     let devtoPost: any;
//     let hashnodePost: any;
//     let redditPost: any;
//     const tumblrHostname = dynamicCredentials.tumblr?.hostname;
//     console.log("socialMediaClient", article.title, article.content, "tumblrHostname", tumblrHostname);
//     const results = await Promise.allSettled([
//       socialMediaClient.createTumblrPost(article.title, article.content, ["trends"]),
//       socialMediaClient.publishDevToPost(article.title, article.content, true),
//       socialMediaClient.publishHashnodePost(article.title, article.content, true),
//       dynamicCredentials.reddit ? socialMediaClient.submitRedditPost(dynamicCredentials.reddit.subreddit, article.title, article.content) : Promise.resolve({ success: false, error: 'Reddit credentials or subreddit not available.' }),
//       // socialMediaClient.createWP(article.title, article.content, "easyseo", "easyseo@gmail.com", [
//       "https://blog2learn.com",
//       "https://shotblogs.com",
//       "https://blog5.net",
//       "https://total-blog.com",
//       "https://ezblogz.com",
//       "https://uzblog.net",
//       "https://blogkoo.com",
//       "https://bloginwi.com",
//       "https://blogerus.com",
//       "https://imblogs.net"
//       // ])
//     ]);
//     console.log("results", results);
//     const [tumblrResult, devtoResult, hashnodeResult, redditResult, wpResult] = results;

//     if (tumblrResult.status === 'rejected') console.error(`Tumblr post failed: ${tumblrResult.reason}`);
//     else tumblrPost = tumblrResult.value;

//     if (devtoResult.status === 'rejected') console.error(`Dev.to post failed: ${devtoResult.reason}`);
//     else devtoPost = devtoResult.value;

//     if (hashnodeResult.status === 'rejected') console.error(`Hashnode post failed: ${hashnodeResult.reason}`);
//     else hashnodePost = hashnodeResult.value;

//     if (redditResult.status === 'rejected') console.error(`Reddit post failed: ${redditResult.reason}`);
//     else redditPost = redditResult.value;

//     const devtoPostUrl = devtoPost?.data?.url;
//     const hashnodePostUrl = hashnodePost?.data?.data?.data?.publishPost?.post?.url;
//     const blogHostname = tumblrHostname || 'sauravwwblog.tumblr.com';
//     const tumblrPostUrl = tumblrPost?.data?.response?.id_string ? `https://${blogHostname}/${tumblrPost.data.response.id_string}` : undefined;
//     const redditPostUrl = redditPost?.data?.url;

//     return { devtoPost: devtoPostUrl, hashnodePost: hashnodePostUrl, tumblrPostUrl, redditPostUrl };
//   }

//   private static async handlePostSuccess(article: Article, dto: CreateArticlePostDto, userId: number, articlePost: ArticlePost, postUrls: string[]) {
//     const updatedPost = await ArticlePostModel.updateStatus(articlePost.id, 'success', undefined, postUrls);

//     await UserActivityLogService.logActivity({
//       user_id: userId,
//       action: 'posted_article',
//       details: { article_id: article.id, website_ids: dto.website_ids, post_id: updatedPost!.id }
//     });
//     return updatedPost;
//   }

//   private static async handlePostFailure(article: Article, dto: CreateArticlePostDto, userId: number, articlePost: ArticlePost, error: any) {
//     await ArticlePostModel.updateStatus(articlePost.id, 'failed', (error as Error).message);

//     await UserActivityLogService.logActivity({
//       user_id: userId,
//       action: 'posted_article_failed',
//       details: { article_id: article.id, website_ids: dto.website_ids, error: (error as Error).message }
//     });
//   }

//   static async getPostsForArticle(articleId: number, userId: number, companyId?: number | null): Promise<ArticlePost[]> {
//     const article = await ArticleService.getArticleById(articleId, userId, companyId);
//     if (!article) {
//       throw new Error('Article not found or access denied.');
//     }
//     return ArticlePostModel.findByArticleId(articleId);
//   }
// } 