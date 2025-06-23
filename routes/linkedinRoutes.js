import express from 'express';
import { 
  redirectToAuth, 
  handleCallback,
  handleCreatePost,
  handleGetPost,
  handleDeletePost,
  handleUpdatePost,
  handleCreateComment,
  handleGetComments,
  handleDeleteComment
} from '../controllers/linkedinController.js';

const router = express.Router();

// --- Swagger Components & Security ---
/**
 * @swagger
 * components:
 *   securitySchemes:
 *     SessionID:
 *       type: apiKey
 *       in: header
 *       name: X-Session-ID
 *       description: Session ID obtained after successful authentication via the /auth/callback endpoint.
 *
 * security:
 *   - SessionID: []
 */

// --- Swagger Tags ---
/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: Handles OAuth 2.0 flow with LinkedIn.
 *   - name: Posts
 *     description: API for creating, reading, and deleting LinkedIn posts.
 *   - name: Comments
 *     description: API for managing comments on LinkedIn posts.
 */

// --- Authentication Routes ---
/**
 * @swagger
 * /api/linkedin/auth:
 *   get:
 *     summary: 1. Redirect to LinkedIn for authentication
 *     tags: [Authentication]
 *     description: Initiates the OAuth 2.0 flow by redirecting the user to the LinkedIn authorization URL.
 *     responses:
 *       302:
 *         description: Redirecting to LinkedIn's OAuth server.
 */
router.get('/auth', redirectToAuth);

/**
 * @swagger
 * /api/linkedin/auth/callback:
 *   get:
 *     summary: 2. Handle LinkedIn OAuth callback
 *     tags: [Authentication]
 *     description: Exchanges the authorization code for an access token and returns a `sessionId`.
 *     parameters:
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *         required: true
 *         description: The authorization code from LinkedIn.
 *     responses:
 *       200:
 *         description: Authentication successful. Returns a `sessionId` to use for other API calls.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Authentication successful. Use the sessionId to make API calls.
 *                 sessionId:
 *                   type: string
 *                   example: jx4f2v
 *                 userUrn:
 *                   type: string
 *                   example: urn:li:person:aBcDeFg123
 *       400:
 *         description: Authentication failed (e.g., user denied access).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Authentication failed: user_cancelled_login"
 */
router.get('/auth/callback', handleCallback);

// --- Post Routes ---
/**
 * @swagger
 * /api/linkedin/posts:
 *   post:
 *     summary: Create a new LinkedIn post
 *     tags: [Posts]
 *     security:
 *       - SessionID: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: The main content/commentary for the post.
 *               article:
 *                 type: object
 *                 description: Optional. Include this object to share a URL.
 *                 properties:
 *                   url: { type: string, format: uri }
 *                   title: { type: string }
 *                   description: { type: string }
 *           examples:
 *             simpleTextPost:
 *               summary: A simple text-only post
 *               value:
 *                 text: "Hello from my API!"
 *             articlePost:
 *               summary: A post with a shared article/URL
 *               value:
 *                 text: "Check out this great article!"
 *                 article:
 *                   url: "https://blog.linkedin.com/"
 *                   title: "Official LinkedIn Blog"
 *                   description: "Your source for insights and information about LinkedIn."
 *     responses:
 *       201:
 *         description: Post created successfully.
 *       401:
 *         description: Unauthorized. Invalid or missing session ID.
 */
router.post('/posts', handleCreatePost);

/**
 * @swagger
 * /api/linkedin/posts/{postId}:
 *   get:
 *     summary: Get a specific LinkedIn post
 *     tags: [Posts]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the post to get details for.
 *     responses:
 *       200:
 *         description: The requested post details.
 *       401:
 *         description: Unauthorized.
 */
router.get('/posts/:postId', handleGetPost);

/**
 * @swagger
 * /api/linkedin/posts/{postId}:
 *   delete:
 *     summary: Delete a specific LinkedIn post
 *     tags: [Posts]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the post to delete.
 *     responses:
 *       204:
 *         description: Successfully deleted the post.
 *       401:
 *         description: Unauthorized.
 */
router.delete('/posts/:postId', handleDeletePost);

/**
 * @swagger
 * /api/linkedin/posts/{postId}:
 *   patch:
 *     summary: Update an existing LinkedIn post
 *     tags: [Posts]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the post to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Post updated successfully.
 *       401:
 *         description: Unauthorized.
 */
router.patch('/posts/:postId', handleUpdatePost);

// --- Comment Routes ---
/**
 * @swagger
 * /api/linkedin/posts/{postId}/comments:
 *   post:
 *     summary: Create a comment on a LinkedIn post
 *     tags: [Comments]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the post to add a comment to.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: The text content of the comment.
 *                 example: "Great point! Thanks for sharing."
 *     responses:
 *       201:
 *         description: Comment created successfully.
 *       401:
 *         description: Unauthorized. Invalid or missing session ID.
 */
router.post('/posts/:postId/comments', handleCreateComment);

/**
 * @swagger
 * /api/linkedin/posts/{postId}/comments:
 *   get:
 *     summary: Get all comments for a LinkedIn post
 *     tags: [Comments]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the post to get comments for.
 *     responses:
 *       200:
 *         description: A list of comments for the specified post.
 *       401:
 *         description: Unauthorized. Invalid or missing session ID.
 */
router.get('/posts/:postId/comments', handleGetComments);

/**
 * @swagger
 * /api/linkedin/comments/{commentId}:
 *   delete:
 *     summary: Delete a specific comment
 *     tags: [Comments]
 *     security:
 *       - SessionID: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the comment to delete. Note that this is the URN of the comment (e.g., urn:li:comment:(urn:li:ugcPost:...,6...)).
 *     responses:
 *       200:
 *         description: Comment deleted successfully.
 *       401:
 *         description: Unauthorized. Invalid or missing session ID.
 */
router.delete('/comments/:commentId', handleDeleteComment);

export default router; 