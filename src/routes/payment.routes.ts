import { Router, Request, Response } from 'express';
import Payment from '../models/Payment';
import PaymentIntent from '../models/PaymentIntent';
import User from '../models/User';
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
 * - Returns status from Payment model OR falls back to User.subscription
 * - Is idempotent and safe to poll
 * 
 * Logic:
 * 1. Check Payment record first (primary source)
 * 2. If Payment not found, check User.subscription via PaymentIntent (fallback)
 * 3. If User.subscription is active (non-free), return 'active'
 * 4. Only return 'failed' if Payment record explicitly marks it failed
 * 5. Default to 'pending' (never guess failure)
 * 
 * Query params:
 * - intent: The payment intent ID (e.g., "wc_xxx")
 * 
 * Response:
 * - 200: Returns status and plan
 * - 400: Missing intent parameter
 * 
 * Status values:
 * - pending: Payment received but not yet activated, or status unknown
 * - active: Plan has been activated (from Payment record OR User.subscription)
 * - failed: Payment explicitly marked as failed by webhook
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

    // 1️⃣ Check Payment record first (primary source of truth)
    const payment = await Payment.findOne({ intent }).lean();

    if (payment) {
      // Payment record exists - return its status
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
    }

    // 2️⃣ Fallback: Check User subscription via PaymentIntent
    // Find PaymentIntent to get userId, then check User.subscription
    const paymentIntent = await PaymentIntent.findOne({ app_intent: intent }).lean();

    if (paymentIntent) {
      const user = await User.findById(paymentIntent.userId).lean();

      if (user?.subscription?.plan && user.subscription.plan !== 'free') {
        // User subscription is active (non-free plan) - payment succeeded
        // This handles the case where Payment record creation failed but User was updated
        logger.info('[Payment Status] Payment record missing but User subscription is active', {
          intent,
          userId: user._id,
          plan: user.subscription.plan
        });

        return res.json({
          success: true,
          status: 'active',
          plan: user.subscription.plan,
          wooOrderId: paymentIntent.woo_order_id || null,
          activatedAt: user.subscription.activatedAt || null
        });
      }
    }

    // 3️⃣ Default: still pending (never guess failure)
    // Payment record doesn't exist and User subscription is not active
    // This means webhook hasn't processed yet, or order is still pending
    logger.info('[Payment Status] Payment not found and User subscription not active, returning pending', { intent });

    return res.json({
      success: true,
      status: 'pending',
      plan: null
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

