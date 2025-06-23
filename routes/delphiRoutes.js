import express from 'express';
import { postToDelphiForums } from '../controllers/delphiController.js';

const router = express.Router();

/**
 * @swagger
 * /api/delphi/post:
 *   post:
 *     summary: Post a new topic to Delphi Forums
 *     tags: [Delphi Forums]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *               - subject
 *               - body
 *             properties:
 *               username:
 *                 type: string
 *                 description: Your Delphi Forums username.
 *               password:
 *                 type: string
 *                 description: Your Delphi Forums password.
 *               subject:
 *                 type: string
 *                 description: The subject of the new topic.
 *               body:
 *                 type: string
 *                 description: The content of the new topic.
 *     responses:
 *       '200':
 *         description: Successfully posted the new topic.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 finalUrl:
 *                   type: string
 *                 responseTime_seconds:
 *                   type: number
 *       '400':
 *         description: Missing required fields.
 *       '500':
 *         description: An error occurred during the operation.
 */
router.post('/post', postToDelphiForums);

export default router; 