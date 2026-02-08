import { Router, Request, Response } from 'express';
import Payment from '../models/Payment';
import { logger } from '../utils/logger.util';

const router = Router();

/**
 * GET /api/payment/status
 * 
 * Read-only endpoint to check payment activation status by intent ID.
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
 * - Returns "pending" if payment not found (webhook hasn't processed yet)
 * 
 * Status values:
 * - pending: Payment received but not yet activated
 * - active: Plan has been activated by webhook
 * - failed: Payment failed or was cancelled
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

    // Look up payment record by intent (read-only, no modifications)
    // Payment model is the single source of truth updated by webhook
    const payment = await Payment.findOne({ intent }).lean();

    // If payment not found, return pending status (webhook hasn't processed yet)
    if (!payment) {
      logger.info('[Payment Status] Payment not found, returning pending', { intent });
      return res.json({
        success: true,
        status: 'pending',
        plan: null
      });
    }

    // Return current status (read-only, no modifications)
    // Status values: pending | active | failed
    logger.info('[Payment Status] Payment found', {
      intent,
      status: payment.status,
      plan: payment.plan
    });

    return res.json({
      success: true,
      status: payment.status,
      plan: payment.plan,
      // Optional: include additional read-only fields for frontend display
      wooOrderId: payment.wooOrderId || null,
      activatedAt: payment.activatedAt || null,
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

