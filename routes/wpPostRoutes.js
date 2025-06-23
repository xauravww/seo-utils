import express from 'express';
import { createPost } from '../controllers/wpPostController.js';

const router = express.Router();

/**
 * @swagger
 * /api/wordpress/posts:
 *   post:
 *     summary: Create a new post on multiple WordPress-based sites
 *     tags: [WordPress]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *               - username
 *               - password
 *               - urls
 *             properties:
 *               title:
 *                 type: string
 *                 description: The title of the post.
 *               content:
 *                 type: string
 *                 description: The content of the post.
 *               username:
 *                 type: string
 *                 description: Your WordPress username.
 *               password:
 *                 type: string
 *                 description: Your WordPress password.
 *               urls:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: url
 *                 description: An array of base URLs of the WordPress sites to post to.
 *           examples:
 *             successfulPost:
 *               summary: Example of a successful post request
 *               value:
 *                 title: "Sample Post Title"
 *                 content: "This is the content of the sample blog post."
 *                 username: "easyseo"
 *                 password: "easyseo@gmail.com"
 *                 urls: [
 *                   "https://blog2learn.com",
 *                   "https://shotblogs.com",
 *                   "https://blog5.net",
 *                   "https://total-blog.com",
 *                   "https://ezblogz.com",
 *                   "https://uzblog.net",
 *                   "https://blogkoo.com",
 *                   "https://bloginwi.com",
 *                   "https://blogerus.com",
 *                   "https://imblogs.net"
 *                 ]
 *     responses:
 *       '200':
 *         description: Successfully created the posts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       success:
 *                         type: boolean
 *                       postUrl:
 *                         type: string
 *                       loginUrl:
 *                         type: string
 *                       message:
 *                         type: string
 *                       error:
 *                         type: string
 *                 responseTime_seconds:
 *                   type: number
 *       '400':
 *         description: Missing required fields.
 *       '500':
 *         description: An unexpected error occurred while processing posts.
 */
router.post('/posts', createPost);

export default router; 