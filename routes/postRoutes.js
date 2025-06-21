import { Router } from 'express';
import { createPost } from '../controllers/postController.js';

const router = Router();

// POST route for creating a new post
router.post('/auto-post', createPost);

export default router; 