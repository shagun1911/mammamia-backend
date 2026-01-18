import { Router } from 'express';
import { chatbotController } from '../controllers/chatbot.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public widget chat endpoint (no auth required)
router.post('/widget/:widgetId/chat', chatbotController.widgetChat);

// All other routes require authentication
router.use(authenticate);

// Chat endpoints
router.post('/chat', chatbotController.chat);
router.post('/voice-chat', chatbotController.voiceChat);
router.post('/test', chatbotController.test);

export default router;

