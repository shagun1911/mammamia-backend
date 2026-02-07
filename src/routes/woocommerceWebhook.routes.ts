import { Router } from 'express';
import woocommerceWebhookController from '../controllers/woocommerceWebhook.controller';

const router = Router();

/**
 * WooCommerce Webhook Route
 * 
 * POST /webhooks/woocommerce
 * 
 * IMPORTANT: The raw body parser is applied in server.ts BEFORE express.json()
 * for the /webhooks/woocommerce path. This ensures the raw request body is available
 * for signature verification.
 * 
 * The signature verification requires the exact raw bytes that WooCommerce sent,
 * not a parsed JSON object.
 */
router.post(
  '/woocommerce',
  woocommerceWebhookController.handleWebhook.bind(woocommerceWebhookController)
);

export default router;

