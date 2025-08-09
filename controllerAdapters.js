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
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cloudinary from 'cloudinary';
import fs from 'fs';

import { getRedditAccessToken, submitRedditPost } from './controllers/redditController.js';
import { sendTweet } from './controllers/social_media/twitterController.js';
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
  DiigoBookmarkingAdapter,
  IndiabookClassifiedAdapter,
  OClickerClassifiedAdapter,
  GainWebAdapter,
  SocialSubmissionEngineAdapter,
  DevToAdapter,
  HashnodeAdapter,
  PlurkAdapter,
  TumblrAdapter, PrePostSEOPingAdapter, BacklinkPingAdapter, ExciteSubmitAdapter,
  DPasteAdapter,
  PastebinAdapter,
  Cl1pAdapter,
  ControlCAdapter,
  JumpArticlesAdapter,
  ArticleBizAdapter,
  ArticleAlleyAdapter,
  KugliAdapter,
  DiigoForumsAdapter,
  WriteAsAdapter,
  TelegraphAdapter,
  AnooxAdapter
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
  console.error('Redis connection error:', err.message);
});
await redisPublisher.connect();

function publishLog(requestId, message, level = 'info') {
  const payload = JSON.stringify({ message, level, timestamp: new Date().toISOString() });
  redisPublisher.publish(`logs:${requestId}`, payload);
}

// --- Clean Adapter Maps ---
// Priority 1: Domain-specific adapters (highest priority)
const domainAdapterMap = {
  // Social Media
  'reddit.com': RedditAdapter,
  'twitter.com': TwitterAdapter,
  'facebook.com': FacebookAdapter,
  'instagram.com': InstagramAdapter,
  'plurk.com': PlurkAdapter,
  'tumblr.com': TumblrAdapter,

  // Article/Paste Sites
  'pastebin.com': PastebinAdapter,
  'dpaste.org': DPasteAdapter,
  'jumparticles.com': JumpArticlesAdapter,
  'articlebiz.com': ArticleBizAdapter,
  'articlealley.com': ArticleAlleyAdapter,
  'cl1p.net': Cl1pAdapter,
  'controlc.com': ControlCAdapter,
  'jumparticles.com': JumpArticlesAdapter,
  'write.as': WriteAsAdapter,
  'telegra.ph': TelegraphAdapter,

  // Blogs
  'dev.to': DevToAdapter,
  'hashnode.com': HashnodeAdapter,

  // Forums
  'delphiforums.com': DelphiForumAdapter,
  'city-data.com': CityDataForumAdapter,
  'openpathshala.com': OpenPathshalaForumAdapter,
  'boards.ie': BoardsIEForumAdapter,
  'groups.diigo.com': DiigoForumsAdapter,

  // Ping Services
  'ping.in': PingInAdapter,
  'prepostseo.com': PrePostSEOPingAdapter,
  'backlinkping.com': BacklinkPingAdapter,
  'excitesubmit.com': ExciteSubmitAdapter,
  'pingmylinks.com': PingMyLinksAdapter,

  // Bookmarking
  'bookmarkzoo.win': BookmarkZooAdapter,
  'teslabookmarks.com': TeslaPearlBookmarkingAdapter,
  'pearlbookmarking.com': TeslaPearlBookmarkingAdapter,
  'diigo.com': DiigoBookmarkingAdapter,
  'bookmarkdrive.com': GenericBookmarking33Adapter,
  'ubookmarking.com': UBookmarkingAdapter,

  // Classified
  'indiabook.com': IndiabookClassifiedAdapter,
  'oclicker.com': OClickerClassifiedAdapter,
  'kugli.com': KugliAdapter,

  // Search/Directory
  'secretsearchenginelabs.com': SecretSearchEngineLabsAdapter,
  'activesearchresults.com': ActiveSearchResultsAdapter,
  'gainweb.org': GainWebAdapter,
  'socialsubmissionengine.com': SocialSubmissionEngineAdapter,
  'anoox.com': AnooxAdapter
};

// Priority 2: Category-based fallbacks (lower priority)
const categoryAdapterMap = {
  'article': Cl1pAdapter,
  'blog': WordPressAdapter,
  'forum': DelphiForumAdapter, // Use DelphiForumAdapter as generic forum fallback
  'social_media': PlurkAdapter,
  'ping': PingInAdapter,
  'bookmarking': GenericBookmarking33Adapter,
  'directory': GainWebAdapter,
  'classified': IndiabookClassifiedAdapter,
  'search': ActiveSearchResultsAdapter
};

export const getAdapter = (jobDetails) => {
  const website = jobDetails.website;

  console.log(`\n🔍 ADAPTER SELECTION | ${website.url} | Category: ${website.category || 'none'}`);

  // Priority 1: Domain-specific adapter (highest priority)
  try {
    const urlObj = new URL(website.url);
    const hostname = urlObj.hostname.replace('www.', '');

    if (domainAdapterMap[hostname]) {
      const AdapterClass = domainAdapterMap[hostname];
      console.log(`✅ SELECTED: ${AdapterClass.name} (domain-specific for ${hostname})`);
      return new AdapterClass(jobDetails);
    }

    console.log(`⚠️  No domain adapter for ${hostname}, checking category fallback...`);
  } catch (e) {
    console.log(`❌ URL parsing failed: ${e.message}`);
  }

  // Priority 2: Category-based fallback
  if (website.category && categoryAdapterMap[website.category]) {
    const AdapterClass = categoryAdapterMap[website.category];
    console.log(`✅ SELECTED: ${AdapterClass.name} (category fallback for '${website.category}')`);
    return new AdapterClass(jobDetails);
  }

  console.log(`🚫 NO ADAPTER FOUND | No domain or category match available\n`);
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


