import express from 'express';
import { postToCityData } from '../controllers/cityDataController.js';

const router = express.Router();

/**
 * @swagger
 * /api/city-data:
 *   post:
 *     summary: Post a new thread to City-Data Forums
 *     tags: [City-Data Forums]
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
 *                 description: Your City-Data Forums username.
 *               password:
 *                 type: string
 *                 description: Your City-Data Forums password.
 *               subject:
 *                 type: string
 *                 description: The subject of the new thread.
 *               body:
 *                 type: string
 *                 description: The main content of the new thread.
 *     responses:
 *       200:
 *         description: Successfully posted the new thread.
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
router.post('/', postToCityData);

export default router; 