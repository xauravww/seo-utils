import { Router } from 'express';
import { publishPost } from '../controllers/publishController.js';

const router = Router();

/**
 * @swagger
 * /api/bloglovin/publish:
 *   post:
 *     summary: Publish a post to Bloglovin'
 *     tags: [Bloglovin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - title
 *               - content
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successfully published the post.
 *       '400':
 *         description: Missing required fields.
 *       '500':
 *         description: An error occurred during the operation.
 */
router.post('/publish', publishPost);

export default router;
