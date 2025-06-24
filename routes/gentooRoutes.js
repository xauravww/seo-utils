import express from 'express';
import { postToGentooForums } from '../controllers/gentooController.js';

const router = express.Router();

/**
 * @swagger
 * /api/gentoo:
 *   post:
 *     summary: Post a new topic to Gentoo Forums.
 *     tags: [Gentoo Forums]
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
 *                 description: Your Gentoo Forums username.
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Your Gentoo Forums password.
 *               subject:
 *                 type: string
 *                 description: The subject of the forum post.
 *               body:
 *                 type: string
 *                 description: The main content of the forum post.
 *     responses:
 *       200:
 *         description: Successfully posted to Gentoo Forums.
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
 *       400:
 *         description: Missing required fields.
 *       500:
 *         description: An error occurred during the operation.
 */
router.post('/gentoo', postToGentooForums);

export default router; 