import { Router } from 'express';
import metaWebhookController from '../controllers/metaWebhook.controller';

const router = Router();

// Instagram webhook routes - PUBLIC (no authentication required)
// Meta sends webhooks here, no JWT tokens

// Webhook verification (GET request)
router.get('/', (req, res) => metaWebhookController.verify(req, res, 'instagram'));

// Webhook event handling (POST request)
router.post('/', metaWebhookController.handleInstagram.bind(metaWebhookController));

export default router;

