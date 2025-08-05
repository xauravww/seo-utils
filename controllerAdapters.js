import dotenv from 'dotenv';
dotenv.config();
import { chromium } from 'patchright';
// import StealthPlugin from 'puppeteer-extra-plugin-stealth'
// chromium.use(StealthPlugin())
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { load } from 'cheerio';
import * as websocketLogger from './websocketLogger.js';
import { getControllerForWebsite } from './websiteClassifier.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cloudinary from 'cloudinary';
import fs from 'fs';

import { getRedditAccessToken, submitRedditPost } from './controllers/redditController.js';
import { sendTweet } from './controllers/social_media/twitterController.js';
import { postToFacebook } from './controllers/social_media/facebookController.js';
import { postToInstagram } from './controllers/social_media/instagramController.js';
import { UBookmarkingAdapter } from './controllers/bookmarking/ubookmarkingController.js';
import GenericBookmarking33Adapter from './adapters/bookmarking/GenericBookmarking33.js';
import { OAuth } from 'oauth';
import { createClient } from 'redis';
import TurnstileBypass from 'turnstile-bypass';

// --- IMPORT ADAPTERS FROM /adapters FOLDER ---
import {
  WordPressAdapter,
  DelphiForumAdapter,
  CityDataForumAdapter,
  OpenPathshalaForumAdapter,
  BoardsIEForumAdapter,
  ForumAdapter,
  PingMyLinksAdapter,
  PingInAdapter,
  RedditAdapter,
  TwitterAdapter,
  FacebookAdapter,
  InstagramAdapter,
  SecretSearchEngineLabsAdapter,
  ActiveSearchResultsAdapter,
  BookmarkZooAdapter,
  TeslaPearlBookmarkingAdapter,
  IndiabookClassifiedAdapter,
  OClickerClassifiedAdapter,
  GainWebAdapter,
  SocialSubmissionEngineAdapter,
  DevToAdapter,
  HashnodeAdapter,
  PlurkAdapter,
  TumblrAdapter,PrePostSEOPingAdapter,BacklinkPingAdapter,ExciteSubmitAdapter,
  DPasteAdapter,
  PastebinAdapter,
  Cl1pAdapter
} from './adapters/index.js';
import BaseAdapter from './adapters/BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('[controllerAdapters.js] REDIS_HOST:', process.env.REDIS_HOST);
const redisProtocol = process.env.REDIS_PROTOCOL || 'redis://';
const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;
const redisPassword = process.env.REDIS_PASSWORD;
const redisUrl = redisPassword
  ? `${redisProtocol}:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
  : `${redisProtocol}${redisHost}:${redisPort}`;

const redisPublisher = createClient({
  url: redisUrl
});
redisPublisher.on('error', (err) => {
  console.error('[controllerAdapters.js][REDIS ERROR]', err);
});
await redisPublisher.connect();

function publishLog(requestId, message, level = 'info') {
    const payload = JSON.stringify({ message, level, timestamp: new Date().toISOString() });
    redisPublisher.publish(`logs:${requestId}`, payload);
}

// --- Adapter map declaration ---
const adapterMap = {
    '../controllers/wpPostController.js': WordPressAdapter,
    '../controllers/postController.js': Cl1pAdapter, // Generic article posting
    '../controllers/ping/pingMyLinksController.js': PingMyLinksAdapter,
    'pingmylinks/googleping': PingMyLinksAdapter,
    'pingmylinks/searchsubmission': PingMyLinksAdapter,
    'pingmylinks/socialsubmission': PingMyLinksAdapter,
    'https://www.pingmylinks.com/googleping': PingMyLinksAdapter,
    'https://www.pingmylinks.com/addurl/socialsubmission': PingMyLinksAdapter,
    'https://www.pingmylinks.com/addurl/searchsubmission': PingMyLinksAdapter,
    '../controllers/search/secretSearchEngineLabsController.js': SecretSearchEngineLabsAdapter,
    '../controllers/search/activeSearchResultsController.js': ActiveSearchResultsAdapter,
    '../controllers/redditController.js': RedditAdapter,
    '../controllers/social_media/twitterController.js': TwitterAdapter,
    '../controllers/social_media/facebookController.js': FacebookAdapter,
    '../controllers/social_media/instagramController.js': InstagramAdapter,
    'plurk.com': PlurkAdapter,
    'social_media': PlurkAdapter,
    '../controllers/bookmarking/bookmarkZooController.js': BookmarkZooAdapter,
    '../controllers/bookmarking/teslaBookmarksController.js': TeslaPearlBookmarkingAdapter,
    'directory/gainweb': GainWebAdapter,
    'directory/socialsubmissionengine': SocialSubmissionEngineAdapter,
    'directory': GainWebAdapter,
    'bookmarking/ubookmarking': UBookmarkingAdapter,
    'bookmarking': GenericBookmarking33Adapter,
    'bookmarkdrive.com': GenericBookmarking33Adapter,
    'devto': DevToAdapter,
    'blog/devto': DevToAdapter,
    'hashnode': HashnodeAdapter,
    'blog/hashnode': HashnodeAdapter,
    'tumblr.com': TumblrAdapter,
    'blog/tumblr': TumblrAdapter,
    '../controllers/forum/delphiController.js': DelphiForumAdapter,
    '../controllers/forum/cityDataController.js': CityDataForumAdapter,
    'forum/delphi': DelphiForumAdapter,
    'forum/citydata': CityDataForumAdapter,
    'delphiforums.com': DelphiForumAdapter,
    'city-data.com': CityDataForumAdapter,
    'ping/ping.in': PingInAdapter,
    'ping': PingInAdapter,
    'https://ping.in': PingInAdapter,
    'ping.in': PingInAdapter,
    'ping/prepostseo.com': PrePostSEOPingAdapter,
    'https://www.prepostseo.com': PrePostSEOPingAdapter,
    'https://www.prepostseo.com/ping-multiple-urls-online': PrePostSEOPingAdapter,
    'prepostseo.com': PrePostSEOPingAdapter,
    'ping/backlinkping.com': BacklinkPingAdapter,
    'https://www.backlinkping.com/online-ping-website-tool': BacklinkPingAdapter,
    'https://www.backlinkping.com': BacklinkPingAdapter,
    'backlinkping.com': BacklinkPingAdapter,
    'ping/excitesubmit.com': ExciteSubmitAdapter,
    'https://excitesubmit.com': ExciteSubmitAdapter,
    'excitesubmit.com': ExciteSubmitAdapter,
    'forum/openpathshala.com': OpenPathshalaForumAdapter,
    'openpathshala.com': OpenPathshalaForumAdapter,
    'forum/boards.ie': BoardsIEForumAdapter,
    'boards.ie': BoardsIEForumAdapter,
    'classified/indiabook.com': IndiabookClassifiedAdapter,
    'https://www.indiabook.com/cgi-bin/classifieds': IndiabookClassifiedAdapter,
    'classified/oclicker.com': OClickerClassifiedAdapter,
    'https://oclicker.com': OClickerClassifiedAdapter,
    'https://dpaste.org': DPasteAdapter,
    'dpaste.org': DPasteAdapter,
    'https://pastebin.com': PastebinAdapter,
    'pastebin.com': PastebinAdapter,
    'article/dpaste': DPasteAdapter,
    'article/pastebin': PastebinAdapter,
    'article': Cl1pAdapter
};

export const getAdapter = (jobDetails) => {
console.log('jobDetails', jobDetails);

    const controllerPath = getControllerForWebsite(jobDetails.website);
    console.log(`[getAdapter] controllerPath: ${controllerPath}`);
    console.log(`[getAdapter] jobDetails.website.category: ${jobDetails.website.category}`);
    console.log(`[getAdapter] jobDetails.website.url: ${jobDetails.website.url}`);

    if (controllerPath && adapterMap[controllerPath]) {
        const AdapterClass = adapterMap[controllerPath];
        return new AdapterClass(jobDetails);
    }

    // NEW: Try matching by full URL
    if (jobDetails.website.url && adapterMap[jobDetails.website.url]) {
        const AdapterClass = adapterMap[jobDetails.website.url];
        return new AdapterClass(jobDetails);
    }

    // Fallback: try matching by domain (hostname)
    try {
        const urlObj = new URL(jobDetails.website.url);
        const hostname = urlObj.hostname;
        if (adapterMap[hostname]) {
            const AdapterClass = adapterMap[hostname];
            return new AdapterClass(jobDetails);
        }
    } catch (e) {
        // ignore URL parse errors
    }

    // Fallback: try matching by category (as a last resort)
    if (jobDetails.website.category && adapterMap[jobDetails.website.category]) {
        const AdapterClass = adapterMap[jobDetails.website.category];
        return new AdapterClass(jobDetails);
    }

    return null;
};

// --- Adapter Factory ---
// Removed duplicate adapterMap and getAdapter declarations to fix redeclaration error

if (process.env.USE_REDIS_CLUSTER === '1' || process.env.USE_REDIS_CLUSTER === 'true') {
  const redisCluster = new IORedis.Cluster([
    {
      host: process.env.REDIS_HOST || 'redis',
      port: Number(process.env.REDIS_PORT) || 6379,
    }
  ], {
    natMap: {
      'redis:6379': { host: 'localhost', port: 6379 },
    }
  });
  redisCluster.on('error', (err) => {
    console.error('[controllerAdapters.js][REDIS CLUSTER ERROR]', err);
  });
  (async () => {
    try {
      await redisCluster.set('test-cluster', 'hello from Redis Cluster');
      const value = await redisCluster.get('test-cluster');
      console.log('[controllerAdapters.js] Redis value (cluster):', value);
    } catch (err) {
      console.error('[controllerAdapters.js][REDIS CLUSTER ERROR]', err);
    }
  })();
}


