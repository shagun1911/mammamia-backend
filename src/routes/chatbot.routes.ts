import { Router } from 'express';
import { chatbotController } from '../controllers/chatbot.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Chat endpoints
router.post('/chat', chatbotController.chat);
router.post('/voice-chat', chatbotController.voiceChat);

export default router;

