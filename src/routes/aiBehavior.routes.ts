import { Router } from 'express';
import { aiBehaviorController } from '../controllers/aiBehavior.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get AI behavior configuration
router.get('/', aiBehaviorController.get);

// Chat Agent routes
router.patch('/chat-agent/improvements', aiBehaviorController.updateChatAgentImprovements);
router.patch('/chat-agent/prompt', aiBehaviorController.updateChatAgentPrompt);
router.patch('/chat-agent/human-operator', aiBehaviorController.updateChatAgentHumanOperator);

// Voice Agent routes
router.patch('/voice-agent/improvements', aiBehaviorController.updateVoiceAgentImprovements);
router.patch('/voice-agent/prompt', aiBehaviorController.updateVoiceAgentPrompt);
router.patch('/voice-agent/language', aiBehaviorController.updateVoiceAgentLanguage);
router.patch('/voice-agent/human-operator', aiBehaviorController.updateVoiceAgentHumanOperator);
router.post('/voice-agent/test', aiBehaviorController.testVoiceAgent);

// Knowledge Base linking
router.patch('/knowledge-base', aiBehaviorController.setKnowledgeBase);

export default router;

