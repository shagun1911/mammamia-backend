import { Router, Request, Response } from 'express';
import PaymentIntent from '../models/PaymentIntent';
import { logger } from '../utils/logger.util';

const router = Router();

/**
 * GET /api/payment/status
 * 
 * Read-only endpoint to check payment status by intent ID.
 * 
 * This endpoint:
 * - Does NOT activate plans
 * - Does NOT update payment records
 * - Does NOT trust frontend redirects
 * - ONLY returns the current status stored by the webhook
 * - Is idempotent and safe to poll
 * 
 * Query params:
 * - intent: The payment intent ID (e.g., "wc_xxx")
 * 
 * Response:
 * - 200: Payment found, returns status and plan
 * - 400: Missing intent parameter
 * - 404: Payment intent not found
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { intent } = req.query;

    // Validate intent parameter
    if (!intent || typeof intent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing intent parameter'
      });
    }

    // Look up payment record by app_intent (read-only, no modifications)
    const payment = await PaymentIntent.findOne({ app_intent: intent }).lean();

    // If payment not found, return 404 with not_found status
    if (!payment) {
      logger.info('[Payment Status] Payment intent not found', { intent });
      return res.status(404).json({
        success: false,
        status: 'not_found',
        message: 'Payment intent not found'
      });
    }

    // Return current status (read-only, no modifications)
    // Status values: pending | active | failed | refunded
    logger.info('[Payment Status] Payment intent found', {
      intent,
      status: payment.status,
      planId: payment.planId
    });

    return res.json({
      success: true,
      status: payment.status,
      plan: payment.planId,
      // Optional: include additional read-only fields for frontend display
      wooOrderId: payment.woo_order_id || null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt
    });

  } catch (error: any) {
    logger.error('[Payment Status] Error checking payment status', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to check payment status'
    });
  }
});

export default router;

