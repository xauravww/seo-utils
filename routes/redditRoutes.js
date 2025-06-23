import { Router } from 'express';
import { postToReddit } from '../controllers/redditController.js';

const router = Router();

/**
 * @swagger
 * /api/reddit/publish:
 *   post:
 *     summary: Create a new Reddit post
 *     tags: [Reddit]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - clientSecret
 *               - username
 *               - password
 *               - subreddit
 *               - title
 *               - text
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: Your Reddit application client ID.
 *               clientSecret:
 *                 type: string
 *                 description: Your Reddit application client secret.
 *               username:
 *                 type: string
 *                 description: Your Reddit username.
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Your Reddit password.
 *               subreddit:
 *                 type: string
 *                 description: The subreddit to post to (e.g., 'test').
 *               title:
 *                 type: string
 *                 description: The title of the Reddit post.
 *               text:
 *                 type: string
 *                 description: The main content of the post.
 *     responses:
 *       200:
 *         description: Post created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 url:
 *                   type: string
 *                   format: uri
 *       400:
 *         description: Missing required fields.
 *       500:
 *         description: Failed to post to Reddit.
 */
router.post('/publish', postToReddit);

export default router; 