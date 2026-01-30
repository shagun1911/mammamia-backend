import { Router } from 'express';
import { emailWebhookController } from '../controllers/emailWebhook.controller';

const router = Router();

// No authentication - called by Python/ElevenLabs API when agent invokes email tool
router.post('/email/:templateId', emailWebhookController.handleEmailWebhook);

export default router;
