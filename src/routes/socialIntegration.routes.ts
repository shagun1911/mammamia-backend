import { Router } from 'express';
import socialIntegrationController from '../controllers/socialIntegration.controller';
import metaWebhookController from '../controllers/metaWebhook.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Meta webhooks - public (Meta sends webhooks here, no auth required)
// WhatsApp webhook
router.get('/whatsapp/webhook', (req, res) => metaWebhookController.verify(req, res, 'whatsapp'));
router.post('/whatsapp/webhook', metaWebhookController.handleWhatsApp.bind(metaWebhookController));

// Messenger webhook
router.get('/messenger/webhook', (req, res) => metaWebhookController.verify(req, res, 'messenger'));
router.post('/messenger/webhook', metaWebhookController.handleMessenger.bind(metaWebhookController));

// Instagram webhook
router.get('/instagram/webhook', (req, res) => metaWebhookController.verify(req, res, 'instagram'));
router.post('/instagram/webhook', metaWebhookController.handleInstagram.bind(metaWebhookController));

// OAuth callback - handle OAuth redirect (public - no auth required, Meta redirects here)
router.get('/:platform/oauth/callback', socialIntegrationController.oauthCallback.bind(socialIntegrationController));

// All other routes require authentication
router.use(authenticate);

// Get all integrations
router.get('/', socialIntegrationController.getAll.bind(socialIntegrationController));

// Get specific platform integration
router.get('/:platform', socialIntegrationController.getByPlatform.bind(socialIntegrationController));

// OAuth flow - initiate OAuth (POST endpoint as frontend expects)
router.post('/:platform/oauth/initiate', socialIntegrationController.initiateOAuth.bind(socialIntegrationController));

// Connect/update integration (manual method - kept for backward compatibility)
router.post('/:platform/connect', socialIntegrationController.connect.bind(socialIntegrationController));

// Test connection
router.post('/:platform/test', socialIntegrationController.testConnection.bind(socialIntegrationController));

// Disconnect integration
router.post('/:platform/disconnect', socialIntegrationController.disconnect.bind(socialIntegrationController));

// Delete integration
router.delete('/:platform', socialIntegrationController.delete.bind(socialIntegrationController));

export default router;

