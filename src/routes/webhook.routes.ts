import { Router } from 'express';
import webhookController from '../controllers/webhook.controller';

const router = Router();

// Webhook verification (GET) and message handling (POST)
// These routes are mounted at /api/v1/webhooks/360dialog in server.ts
router.get('/', webhookController.verify.bind(webhookController));
router.post('/', webhookController.handleIncoming.bind(webhookController));

export default router;
