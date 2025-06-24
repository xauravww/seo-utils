import express from 'express';
import { postToSimpleMachines } from '../controllers/simpleMachinesController.js';

const router = express.Router();

/**
 * @swagger
 * /api/simple-machines:
 *   post:
 *     summary: Post a new thread to Simple Machines Forums
 *     tags: [Simple Machines Forums]
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
 *               password:
 *                 type: string
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully posted the new thread.
 *       400:
 *         description: Missing required fields or API key.
 *       500:
 *         description: An error occurred during the operation.
 */
router.post('/', postToSimpleMachines);

export default router; 