import { Request, Response } from 'express';
import crypto from 'crypto';
import PaymentIntent from '../models/PaymentIntent';
import User from '../models/User';
import Organization from '../models/Organization';
import Plan from '../models/Plan';
import Profile from '../models/Profile';
import { planService } from '../services/plan.service';
import { logger } from '../utils/logger.util';
import { getPlanLimits } from '../config/planLimits';

/**
 * WooCommerce Webhook Controller
 * 
 * Handles order.updated webhooks from WooCommerce to activate/deactivate user plans.
 * 
 * Security:
 * - Verifies X-WC-Webhook-Signature header using HMAC SHA256
 * - Uses raw request body for signature verification
 * 
 * Business Rules:
 * - Only processes orders with app_uid, app_plan, and app_intent meta fields
 * - Activates plans when order status is 'processing' or 'completed'
 * - Marks payment intent as failed when order status is 'failed' or 'cancelled'
 * - Deactivates plans when order status is 'refunded'
 * - Idempotent: safe to retry (checks existing payment intent status)
 */
export class WooCommerceWebhookController {
  /**
   * Verify WooCommerce webhook signature
   * 
   * WooCommerce signs webhooks using HMAC SHA256 with the webhook secret.
   * The signature is sent in the X-WC-Webhook-Signature header as base64.
   * 
   * Only verifies if signature header exists. Returns true if no signature
   * (for test deliveries or if signature is optional).
   */
  private verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    // If no signature header, allow (might be a test delivery)
    if (!signature) {
      logger.info('[WooCommerce Webhook] No signature header present, allowing request');
      return true;
    }

    const webhookSecret = process.env.WC_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      logger.warn('[WooCommerce Webhook] WC_WEBHOOK_SECRET not set, skipping signature verification');
      return true; // Allow if secret not configured (for development)
    }

    // Calculate expected signature using base64
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('base64');

    // Compare signatures using constant-time comparison to prevent timing attacks
    try {
      // Both signatures are base64 strings
      const receivedBuffer = Buffer.from(signature, 'base64');
      const expectedBuffer = Buffer.from(expectedSignature, 'base64');
      
      if (receivedBuffer.length !== expectedBuffer.length) {
        logger.warn('[WooCommerce Webhook] Signature length mismatch');
        return false;
      }

      const isValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
      
      if (!isValid) {
        logger.warn('[WooCommerce Webhook] Invalid signature', {
          received: signature.substring(0, 10) + '...',
          expected: expectedSignature.substring(0, 10) + '...'
        });
      }
      
      return isValid;
    } catch (error) {
      // If signature is not valid base64, comparison fails
      logger.warn('[WooCommerce Webhook] Signature format error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Extract meta field value from WooCommerce order meta_data array
   * 
   * WooCommerce stores custom meta fields in order.meta_data as an array of objects:
   * [{ key: 'app_uid', value: '...' }, { key: 'app_plan', value: '...' }]
   */
  private extractMetaField(metaData: any[], key: string): string | null {
    if (!Array.isArray(metaData)) {
      return null;
    }

    const metaItem = metaData.find((item: any) => item.key === key);
    return metaItem?.value || null;
  }

  /**
   * Handle WooCommerce order.updated webhook
   * 
   * POST /webhooks/woocommerce
   * 
   * This endpoint must use express.raw() middleware to receive the raw body
   * for signature verification. The route is defined BEFORE express.json()
   * in server.ts to ensure the raw body is available.
   * 
   * IMPORTANT: Never returns 4xx errors to WooCommerce. Always returns 200 OK
   * to prevent retries. Errors are logged but not exposed.
   */
  async handleWebhook(req: Request, res: Response) {
    try {
      // Get raw body (must be Buffer for signature verification)
      const rawBody = req.body;
      
      // If body is not a Buffer, this route was hit after express.json() parsed it
      // Return 200 OK and ignore (never return 4xx to WooCommerce)
      if (!Buffer.isBuffer(rawBody)) {
        logger.warn('[WooCommerce Webhook] Request body is not a Buffer. Route may be defined after express.json().');
        return res.status(200).json({
          success: true,
          message: 'Request ignored (body already parsed)'
        });
      }

      // Verify signature (only if header exists)
      const signature = req.headers['x-wc-webhook-signature'] as string | undefined;
      
      if (!this.verifySignature(rawBody, signature)) {
        logger.warn('[WooCommerce Webhook] Signature verification failed', {
          hasSignature: !!signature,
          bodyLength: rawBody.length
        });
        // Return 200 OK even on signature failure (never return 4xx to WooCommerce)
        return res.status(200).json({
          success: false,
          message: 'Signature verification failed, request ignored'
        });
      }

      // Parse JSON body
      let orderData: any;
      try {
        orderData = JSON.parse(rawBody.toString('utf8'));
      } catch (parseError) {
        logger.warn('[WooCommerce Webhook] Failed to parse JSON body', parseError);
        // Return 200 OK for malformed payloads (never return 4xx to WooCommerce)
        return res.status(200).json({
          success: true,
          message: 'Invalid JSON payload, request ignored'
        });
      }

      // Extract order information
      const orderId = orderData.id;
      const orderStatus = orderData.status;
      const metaData = orderData.meta_data || [];

      logger.info('[WooCommerce Webhook] Received order update', {
        orderId,
        orderStatus,
        hasMetaData: Array.isArray(metaData) && metaData.length > 0
      });

      // Extract required meta fields
      const appUid = this.extractMetaField(metaData, 'app_uid');
      const appPlan = this.extractMetaField(metaData, 'app_plan');
      const appIntent = this.extractMetaField(metaData, 'app_intent');

      // If any required meta field is missing, ignore this order (not a SaaS order)
      if (!appUid || !appPlan || !appIntent) {
        logger.info('[WooCommerce Webhook] Order missing required meta fields, ignoring', {
          orderId,
          hasAppUid: !!appUid,
          hasAppPlan: !!appPlan,
          hasAppIntent: !!appIntent
        });
        return res.status(200).json({
          success: true,
          message: 'Order ignored (not a SaaS order)'
        });
      }

      // Find user
      const user = await User.findById(appUid);
      if (!user) {
        logger.warn('[WooCommerce Webhook] User not found', { userId: appUid, orderId });
        return res.status(200).json({
          success: true,
          message: 'User not found, order ignored'
        });
      }

      // Find or create payment intent (idempotency: check if already processed)
      let paymentIntent = await PaymentIntent.findOne({ app_intent: appIntent });

      if (!paymentIntent) {
        // Create new payment intent
        paymentIntent = await PaymentIntent.create({
          app_intent: appIntent,
          userId: user._id,
          planId: appPlan,
          status: 'pending',
          woo_order_id: orderId
        });
        logger.info('[WooCommerce Webhook] Created payment intent', {
          appIntent,
          userId: appUid,
          orderId
        });
      } else {
        // Update existing payment intent with order ID if missing
        if (!paymentIntent.woo_order_id) {
          paymentIntent.woo_order_id = orderId;
          await paymentIntent.save();
        }
      }

      // Process order status
      await this.processOrderStatus(orderStatus, paymentIntent, user, appPlan, orderId);

      // Always return 200 OK to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        orderId,
        orderStatus
      });

    } catch (error: any) {
      logger.error('[WooCommerce Webhook] Error processing webhook', {
        error: error.message,
        stack: error.stack
      });

      // Still return 200 OK to prevent WooCommerce from retrying
      // (we'll handle errors internally and log them)
      return res.status(200).json({
        success: false,
        error: 'Webhook received but processing failed',
        message: error.message
      });
    }
  }

  /**
   * Process order status and update payment intent / user plan accordingly
   * 
   * Business Rules:
   * - processing/completed → activate plan
   * - failed/cancelled → mark payment intent as failed
   * - refunded → deactivate plan
   */
  private async processOrderStatus(
    orderStatus: string,
    paymentIntent: any,
    user: any,
    planSlug: string,
    orderId: number
  ) {
    const normalizedStatus = orderStatus.toLowerCase();

    // Activate plan for processing or completed orders
    if (normalizedStatus === 'processing' || normalizedStatus === 'completed') {
      // Check if already activated (idempotency)
      if (paymentIntent.status === 'active') {
        logger.info('[WooCommerce Webhook] Plan already active, skipping activation', {
          appIntent: paymentIntent.app_intent,
          orderId
        });
        return;
      }

      // Update payment intent status
      paymentIntent.status = 'active';
      paymentIntent.woo_order_id = orderId;
      await paymentIntent.save();

      // Activate plan for user (ONLY place where plans are activated)
      try {
        // Get plan limits from config
        const limits = getPlanLimits(planSlug);
        
        if (!limits) {
          throw new Error(`Unknown plan: ${planSlug}. Cannot activate.`);
        }

        // Normalize plan key (handle variations like "mileva-pack" -> "mileva")
        let normalizedPlanKey = planSlug.toLowerCase().trim();
        if (normalizedPlanKey === 'mileva-pack') normalizedPlanKey = 'mileva';
        if (normalizedPlanKey === 'nobel-pack') normalizedPlanKey = 'nobel';
        if (normalizedPlanKey === 'aistein-pro-pack' || normalizedPlanKey === 'aistein-pro') normalizedPlanKey = 'pro';
        if (normalizedPlanKey === 'set-up') normalizedPlanKey = 'setup';

        // Activate plan on User model (single source of truth)
        // This is the ONLY place where plans are activated
        // Initialize subscription if it doesn't exist, or reset usage on upgrade
        const currentUser = await User.findById(user._id);
        const currentPlan = currentUser?.subscription?.plan || 'free';
        
        // Reset usage to 0 when activating/upgrading plan (fresh start)
        await User.findByIdAndUpdate(user._id, {
          'subscription.plan': normalizedPlanKey,
          'subscription.limits': {
            conversations: limits.conversations,
            minutes: limits.minutes,
            automations: limits.automations
          },
          'subscription.usage': {
            conversations: 0,
            minutes: 0,
            automations: 0
          },
          'subscription.activatedAt': new Date()
        }, {
          upsert: false, // Don't create if doesn't exist - handled by getCurrentUser
          new: true
        });

        logger.info('[WooCommerce Webhook] Plan activated on User model', {
          userId: user._id,
          planKey: normalizedPlanKey,
          limits,
          orderId,
          appIntent: paymentIntent.app_intent
        });

        // Also update organization plan (for backward compatibility)
        if (user.organizationId) {
          const result = await planService.assignPlanToOrganization(
            user.organizationId.toString(),
            planSlug
          );

          logger.info('[WooCommerce Webhook] Plan also updated on Organization', {
            organizationId: user.organizationId,
            planSlug,
            planName: result.plan.name
          });
        }
      } catch (error: any) {
        logger.error('[WooCommerce Webhook] Failed to activate plan', {
          error: error.message,
          userId: user._id,
          planSlug,
          orderId
        });
        throw error;
      }
    }
    // Mark payment intent as failed
    else if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
      if (paymentIntent.status !== 'failed') {
        paymentIntent.status = 'failed';
        paymentIntent.woo_order_id = orderId;
        await paymentIntent.save();

        logger.info('[WooCommerce Webhook] Payment intent marked as failed', {
          appIntent: paymentIntent.app_intent,
          orderId,
          orderStatus
        });
      }
    }
    // Deactivate plan for refunded orders
    else if (normalizedStatus === 'refunded') {
      // Check if already refunded (idempotency)
      if (paymentIntent.status === 'refunded') {
        logger.info('[WooCommerce Webhook] Payment intent already marked as refunded', {
          appIntent: paymentIntent.app_intent,
          orderId
        });
        return;
      }

      paymentIntent.status = 'refunded';
      paymentIntent.woo_order_id = orderId;
      await paymentIntent.save();

      // Deactivate user's plan (revert to default/free plan)
      try {
        if (!user.organizationId) {
          throw new Error('User has no organization');
        }

        const organization = await Organization.findById(user.organizationId);
        if (!organization) {
          throw new Error('Organization not found');
        }

        // Get default plan
        const defaultPlan = await Plan.findOne({ isDefault: true }) || 
                           await Plan.findOne({ slug: 'free' });

        if (defaultPlan) {
          organization.plan = defaultPlan.slug;
          organization.planId = defaultPlan._id;
          await organization.save();

          // Update user's selectedProfile
          user.selectedProfile = defaultPlan.slug;
          await user.save();

          // Deactivate profile
          const profile = await Profile.findOne({ organizationId: organization._id });
          if (profile) {
            profile.isActive = false;
            await profile.save();
          }

          logger.info('[WooCommerce Webhook] Plan deactivated (refunded)', {
            userId: user._id,
            previousPlan: planSlug,
            newPlan: defaultPlan.slug,
            orderId,
            appIntent: paymentIntent.app_intent
          });
        } else {
          logger.warn('[WooCommerce Webhook] No default plan found for refund', {
            userId: user._id,
            orderId
          });
        }
      } catch (error: any) {
        logger.error('[WooCommerce Webhook] Failed to deactivate plan', {
          error: error.message,
          userId: user._id,
          orderId
        });
        throw error;
      }
    }
    // Unknown status - log but don't fail
    else {
      logger.info('[WooCommerce Webhook] Unknown order status, no action taken', {
        orderStatus,
        orderId,
        appIntent: paymentIntent.app_intent
      });
    }
  }
}

export default new WooCommerceWebhookController();

