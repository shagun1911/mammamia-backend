import { Router } from 'express';
import metaWebhookController from '../controllers/metaWebhook.controller';

const router = Router();

// Instagram webhook routes - PUBLIC (no authentication required)
// Meta sends webhooks here, no JWT tokens

// High-signal logging so we can confirm Meta is hitting the endpoint.
router.use((req, _res, next) => {
  try {
    const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    console.log('[Instagram Webhook Route] hit', {
      method: req.method,
      path: req.path,
      query: req.query,
      contentType: req.headers['content-type'],
      bodyKeys
    });
  } catch {
    // Never block webhook handling because logging failed.
  }
  next();
});

// Webhook verification (GET request)
router.get('/', (req, res) => metaWebhookController.verify(req, res, 'instagram'));

// Webhook event handling (POST request)
router.post('/', metaWebhookController.handleInstagram.bind(metaWebhookController));

export default router;

