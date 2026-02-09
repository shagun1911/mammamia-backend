import { Router, Request, Response } from 'express';
import Payment from '../models/Payment';
import PaymentIntent from '../models/PaymentIntent';
import User from '../models/User';
import { logger } from '../utils/logger.util';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { getPlanLimits } from '../config/planLimits';

const router = Router();

/**
 * POST /api/payment/confirm
 * 
 * Activate plan immediately when user is redirected back from WooCommerce checkout.
 * 
 * This endpoint:
 * - Requires authentication (user must be logged in)
 * - Activates plan immediately (no webhook required)
 * - Prevents reuse of payment intents
 * - Is idempotent (safe to retry)
 * 
 * Payload:
 * - intent: Payment intent ID (e.g., "wc_xxx")
 * - plan: Plan slug (e.g., "nobel", "mileva", "pro")
 * 
 * Security:
 * - Uses req.user.id (ignores any uid from client)
 * - Plan limits enforced server-side
 * - Intent reuse blocked
 */
router.post('/confirm', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user._id || req.user.id;
    const { intent, plan } = req.body;

    if (!intent || !plan) {
      return res.status(400).json({ error: "Missing intent or plan" });
    }

    // Prevent reuse
    const existingPayment = await Payment.findOne({ intent });
    if (existingPayment?.status === "active") {
      return res.json({ status: "already_active" });
    }

    // Resolve plan limits
    const limits = getPlanLimits(plan);
    if (!limits) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    // Normalize plan key (handle variations like "mileva-pack" -> "mileva")
    let normalizedPlanKey = plan.toLowerCase().trim();
    if (normalizedPlanKey === 'mileva-pack') normalizedPlanKey = 'mileva';
    if (normalizedPlanKey === 'nobel-pack') normalizedPlanKey = 'nobel';
    if (normalizedPlanKey === 'aistein-pro-pack' || normalizedPlanKey === 'aistein-pro') normalizedPlanKey = 'pro';
    if (normalizedPlanKey === 'set-up') normalizedPlanKey = 'setup';

    const activatedAt = new Date();

    // 1️⃣ Create/Update Payment (source of truth)
    await Payment.findOneAndUpdate(
      { intent },
      {
        intent,
        userId,
        plan: normalizedPlanKey,
        status: "active",
        activatedAt
      },
      { upsert: true }
    );

    // 2️⃣ Activate user subscription (REAL source of truth)
    // Replace entire subscription object - do not rely on partial updates
    await User.findByIdAndUpdate(userId, {
      subscription: {
        plan: normalizedPlanKey,
        limits: limits,
        usage: {
          conversations: 0,
          minutes: 0,
          automations: 0
        },
        activatedAt: activatedAt
      }
    });

    logger.info('[Payment Confirm] Plan activated', {
      intent,
      userId,
      plan: normalizedPlanKey,
      limits
    });

    return res.json({
      status: "active",
      plan: normalizedPlanKey,
      limits
    });

  } catch (error: any) {
    logger.error('[Payment Confirm] Error activating plan', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to activate plan'
    });
  }
});

/**
 * POST /api/payment/force-activate
 * 
 * FORCE activate plan immediately - no webhook, no polling, no waiting.
 * 
 * This endpoint:
 * - Requires authentication (user must be logged in)
 * - FORCES activation immediately (no webhook dependency)
 * - Is idempotent (if already active, returns success)
 * - Does NOT check order status
 * - Does NOT wait for anything
 * 
 * Payload:
 * - intent: Payment intent ID (e.g., "wc_xxx")
 * - plan: Plan slug (e.g., "nobel", "mileva", "pro")
 * 
 * Security:
 * - Uses req.user.id (ignores any uid from client)
 * - Plan limits enforced server-side
 */
router.post('/force-activate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user._id || req.user.id;
    const { intent, plan } = req.body;

    if (!intent || !plan) {
      return res.status(400).json({ error: "intent and plan required" });
    }

    const limits = getPlanLimits(plan);
    if (!limits) {
      return res.status(400).json({ error: "invalid plan" });
    }

    const activatedAt = new Date();

    // 🔒 Idempotency: if already active, return success
    const existing = await Payment.findOne({ intent });
    if (existing?.status === "active") {
      return res.json({ status: "active" });
    }

    // Normalize plan key (handle variations like "mileva-pack" -> "mileva")
    let normalizedPlanKey = plan.toLowerCase().trim();
    if (normalizedPlanKey === 'mileva-pack') normalizedPlanKey = 'mileva';
    if (normalizedPlanKey === 'nobel-pack') normalizedPlanKey = 'nobel';
    if (normalizedPlanKey === 'aistein-pro-pack' || normalizedPlanKey === 'aistein-pro') normalizedPlanKey = 'pro';
    if (normalizedPlanKey === 'set-up') normalizedPlanKey = 'setup';

    // 1️⃣ FORCE Payment record
    await Payment.findOneAndUpdate(
      { intent },
      {
        intent,
        userId,
        plan: normalizedPlanKey,
        status: "active",
        activatedAt
      },
      { upsert: true }
    );

    // 2️⃣ FORCE User subscription
    // Replace entire subscription object - do not rely on partial updates
    await User.findByIdAndUpdate(userId, {
      subscription: {
        plan: normalizedPlanKey,
        limits: limits,
        usage: {
          conversations: 0,
          minutes: 0,
          automations: 0
        },
        activatedAt: activatedAt
      }
    });

    logger.info('[Payment Force Activate] Plan activated', {
      intent,
      userId,
      plan: normalizedPlanKey,
      limits
    });

    return res.json({
      status: "active",
      plan: normalizedPlanKey,
      limits
    });
  } catch (e: any) {
    console.error("FORCE ACTIVATE FAILED", e);
    logger.error('[Payment Force Activate] Error activating plan', {
      error: e.message,
      stack: e.stack
    });
    return res.status(500).json({ error: "activation failed" });
  }
});

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

