import { Router } from 'express';
import { publishPost } from '../controllers/publishController.js';

const router = Router();

router.post('/publish', publishPost);

export default router;
