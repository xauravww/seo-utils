# Adapter Logging Standards

This document outlines the standardized logging formats implemented across all adapters for consistent parsing and monitoring.

## Standardized Log Formats

### 1. Publication Success URLs
**Format:** `Publication successful! URL: {url}`
**Usage:** When a post/publication is successfully created
**Method:** `this.logPublicationSuccess(url)`

**Examples:**
- `Publication successful! URL: https://dev.to/user/my-article-123`
- `Publication successful! URL: https://twitter.com/user/status/123456789`
- `Publication successful! URL: https://www.reddit.com/r/subreddit/comments/abc123/`

### 2. Screenshot Uploads
**Format:** `Screenshot uploaded: {url}`
**Usage:** When a screenshot is successfully uploaded to Cloudinary
**Method:** `this.logScreenshotUploaded(url)`

**Examples:**
- `Screenshot uploaded: https://res.cloudinary.com/account/image/upload/v123/screenshot.png`

### 3. Error Screenshot Uploads
**Format:** `Error screenshot uploaded: {url}`
**Usage:** When an error screenshot is successfully uploaded to Cloudinary
**Method:** `this.logErrorScreenshotUploaded(url)`

**Examples:**
- `Error screenshot uploaded: https://res.cloudinary.com/account/image/upload/v123/error-screenshot.png`

## Implementation

### BaseAdapter Methods
The BaseAdapter class provides three standardized logging methods:

```javascript
// Log successful publication with URL
logPublicationSuccess(url) {
    this.log(`Publication successful! URL: ${url}`, 'success', true);
}

// Log successful screenshot upload
logScreenshotUploaded(url) {
    this.log(`Screenshot uploaded: ${url}`, 'info', true);
}

// Log successful error screenshot upload
logErrorScreenshotUploaded(url) {
    this.log(`Error screenshot uploaded: ${url}`, 'error', true);
}
```

### Usage in Adapters
Instead of custom log messages, adapters should use these standardized methods:

```javascript
// OLD (inconsistent)
this.log(`[SUCCESS] Facebook post created successfully! URL: ${postUrl}`, 'success', true);
this.log(`Dev.to post created: ${postUrl}`, 'success', true);
this.log(`[EVENT] Screenshot uploaded to Cloudinary: ${url}`, 'info', true);

// NEW (standardized)
this.logPublicationSuccess(postUrl);
this.logScreenshotUploaded(url);
this.logErrorScreenshotUploaded(errorUrl);
```

## Benefits

1. **Consistent Parsing**: Log parsers can easily extract URLs using regex patterns
2. **Monitoring**: Automated systems can track success rates and URLs
3. **Debugging**: Standardized formats make troubleshooting easier
4. **Analytics**: Easy to generate reports on publication success and screenshot uploads

## Parsing Patterns

For automated parsing, use these regex patterns:

```javascript
// Extract publication URLs
const publicationUrlPattern = /Publication successful! URL: (https?:\/\/[^\s]+)/g;

// Extract screenshot URLs
const screenshotUrlPattern = /Screenshot uploaded: (https?:\/\/[^\s]+)/g;

// Extract error screenshot URLs
const errorScreenshotUrlPattern = /Error screenshot uploaded: (https?:\/\/[^\s]+)/g;
```

## Updated Adapters

The following adapters have been updated to use the standardized logging format:

### Social Media Adapters
- ✅ FacebookAdapter.js
- ✅ TwitterAdapter.js
- ✅ InstagramAdapter.js
- ✅ RedditAdapter.js
- ✅ PlurkAdapter.js

### Blog Adapters
- ✅ DevToAdapter.js

### Forum Adapters
- ✅ BoardsIEForumAdapter.js
- ✅ DelphiForumAdapter.js
- ✅ CityDataForumAdapter.js
- ✅ OpenPathshalaForumAdapter.js

### Ping Adapters
- ✅ PingInAdapter.js
- ✅ BacklinkPingAdapter.js
- ✅ PrePostSEOPingAdapter.js
- ✅ PingMyLinksAdapter.js
- ✅ ExciteSubmitAdapter.js

### Bookmarking Adapters
- ✅ BookmarkZooAdapter.js
- ✅ GenericBookmarking33.js

### Classified Adapters
- ✅ OClickerClassifiedAdapter.js

### Base Adapter
- ✅ BaseAdapter.js (includes standardized methods and error handling)

## Migration Notes

When creating new adapters or updating existing ones:

1. Always use the standardized logging methods from BaseAdapter
2. Ensure publication success logs include the actual URL
3. Use consistent screenshot logging for both success and error cases
4. Test that log parsing works correctly with the new formats