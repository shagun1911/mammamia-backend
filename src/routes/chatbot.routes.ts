import { Router } from 'express';
import { chatbotController } from '../controllers/chatbot.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkPlanStatus, enforceChatLimit } from '../middleware/planEnforcement.middleware';

const router = Router();

// Public widget chat endpoint (no auth required)
// Note: Plan enforcement for widget is handled INSIDE the controller using widgetId
router.post('/widget/:widgetId/chat', chatbotController.widgetChat);

// All other routes require authentication
router.use(authenticate);
router.use(checkPlanStatus);

// Chat endpoints
router.post('/chat', enforceChatLimit, chatbotController.chat);
router.post('/voice-chat', enforceChatLimit, chatbotController.voiceChat);
router.post('/test', chatbotController.test);

export default router;

