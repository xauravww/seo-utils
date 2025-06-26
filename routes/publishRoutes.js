import express from 'express';
import { publish } from '../controllers/publishController.js';

const router = express.Router();

/**
 * @swagger
 * /api/publish:
 *   post:
 *     summary: Submits content to multiple websites for publishing in the background.
 *     tags: [Publishing]
 *     description: |
 *       Accepts a list of websites, each with its own category and credentials.
 *       The API immediately returns a `requestId` and processes the submissions in the background.
 *       Use the `requestId` to connect to the WebSocket endpoint for real-time logging.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [websites, content]
 *             properties:
 *               websites:
 *                 type: array
 *                 description: A list of website objects to post to.
 *                 items:
 *                   type: object
 *                   required: [url, category, credentials]
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *                       example: 'https://blog2learn.com'
 *                     category:
 *                       type: string
 *                       description: The type of website, which determines the publishing strategy.
 *                       enum: [blog, article, forum, social_media]
 *                       example: 'blog'
 *                     credentials:
 *                       type: object
 *                       required: [username, password]
 *                       properties:
 *                         username: { type: string, example: 'easyseo' }
 *                         password: { type: string, example: 'easyseo@gmail.com' }
 *               content:
 *                 type: object
 *                 required: [title, body]
 *                 properties:
 *                   title:
 *                     type: string
 *                     example: 'My Awesome Post Title'
 *                   body:
 *                     type: string
 *                     example: 'This is the full content of the post.'
 *     responses:
 *       202:
 *         description: Request accepted for background processing.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: 'Request received. Processing will start shortly.' }
 *                 requestId: { type: string, format: uuid, example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }
 *       400:
 *         description: Bad request, such as a missing or invalid websites array.
 */
router.post('/', publish);

export default router;
