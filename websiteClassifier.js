// A simple mapping from website category to its corresponding controller.

const controllerMap = {
    // Specific categories first
    'blog': '../controllers/wpPostController.js',
    'forum': '../controllers/simpleMachinesController.js',
    'social_media': '../controllers/linkedinController.js', // Default social media, can be overridden by domain
    'article': '../controllers/postController.js', // Generic article poster
    'search/secretsearchenginelabs': '../controllers/search/secretSearchEngineLabsController.js',
    'pingmylinks': '../controllers/ping/pingMyLinksController.js',
    'pingmylinks/googleping': '../controllers/ping/pingMyLinksController.js',
    'pingmylinks/searchsubmission': '../controllers/ping/pingMyLinksController.js',
    'pingmylinks/socialsubmission': '../controllers/ping/pingMyLinksController.js',
    'pingmylinks/addurl': '../controllers/ping/pingMyLinksController.js',
    'search/activesearchresults': '../controllers/search/activeSearchResultsController.js',

    // We can add more mappings here for:
    // search, ping, classified, bookmarking, directory
};

const domainMap = {
    'linkedin.com': '../controllers/linkedinController.js',
    'reddit.com': '../controllers/redditController.js',
    'twitter.com': '../controllers/social_media/twitterController.js',
    'facebook.com': '../controllers/social_media/facebookController.js',
    'instagram.com': '../controllers/social_media/instagramController.js',
    'pinterest.com': '../controllers/social_media/pinterestController.js',
    'bookmarkzoo.win': '../controllers/bookmarking/bookmarkZooController.js',
    'teslabookmarks.com': '../controllers/bookmarking/teslaBookmarksController.js',
    'pearlbookmarking.com': '../controllers/bookmarking/teslaBookmarksController.js',
    'dev.to': 'devto',
    // We can add other domain-specific controllers here
};

/**
 * Gets the appropriate controller for a given website.
 * It first checks for a domain-specific controller, then falls back to a category-based one.
 * @param {object} website - The website object, e.g., { url: 'https://www.reddit.com', category: 'social_media' }
 * @returns {string|null} The path to the controller module, or null if not found.
 */
export const getControllerForWebsite = (website) => {
    try {
        const url = new URL(website.url);
        const domain = url.hostname.replace('www.', '');

        if (domainMap[domain]) {
            return domainMap[domain];
        }

        // Special case: Only for blog2learn.com and uzblog.net with category 'article', use WordPress controller
        if ((website.category === 'article' || website.category==='blog') && (domain === 'blog2learn.com' || domain === 'uzblog.net' ||domain=='blogkoo.com' || domain === 'imblogs.net' || domain==='blogerus.com' || domain==='bloginwi.com' || domain==='ezblogz.com' || domain==='blog5.net'|| domain==='total-blog.com' || domain==='shotblogs.com')) {
            return '../controllers/wpPostController.js';
        }

        // Special case: dev.to should use DevToAdapter for both 'article' and 'blog' categories
        if ((website.category === 'blog' || website.category === 'article') && domain === 'dev.to') {
            return 'devto';
        }

        // Special case: hashnode.com should use HashnodeAdapter for both 'article' and 'blog' categories
        if ((website.category === 'blog' || website.category === 'article') && (domain === 'hashnode.com' || domain.endsWith('.hashnode.dev'))) {
            return 'hashnode';
        }

        if (website.category && controllerMap[website.category]) {
            return controllerMap[website.category];
        }
    } catch (error) {
        console.error(`Invalid URL provided for website: ${website.url}`, error);
        return null;
    }

    return null; // No controller found
}; 