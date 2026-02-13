import { Router } from 'express';
import { elevenlabsWebhookController } from '../controllers/elevenlabsWebhook.controller';

const router = Router();

// No authentication - called by ElevenLabs API webhook
// This endpoint logs all incoming webhook data from ElevenLabs
router.post('/', elevenlabsWebhookController.handleWebhook);

export default router;

