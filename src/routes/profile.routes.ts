import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import Organization from '../models/Organization';
import { usageTrackerService } from '../services/usage/usageTracker.service';
import { profileService } from '../services/profile.service';
import { logger } from '../utils/logger.util';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/profile/billing
 * Get current user's billing information and usage (user-based system)
 */
router.get('/billing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.user as any)?._id || (req.user as any)?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const usageStats = await profileService.getUsageStats(userId);

    // If usageStats returns null (no organization linked), we handle it
    if (!usageStats) {
      // Try to get basic user info
      const User = require('../models/User').default;
      const user = await User.findById(userId).lean();
      const Plan = require('../models/Plan').default;
      const freePlan = await Plan.findOne({ slug: 'free' }).lean();
      
      const defaultPlan = freePlan || {
        _id: null,
        name: 'Free',
        slug: 'free',
        description: 'Free plan with basic features',
        price: 0,
        currency: 'USD',
        features: {
          callMinutes: 100,
          chatConversations: 100,
          automations: 5,
          users: 1,
          customFeatures: []
        }
      };
      
      return res.json({
        success: true,
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          selectedProfile: 'free'
        },
        plan: {
          _id: defaultPlan._id,
          name: defaultPlan.name,
          slug: defaultPlan.slug,
          description: defaultPlan.description,
          price: defaultPlan.price,
          currency: defaultPlan.currency,
          features: {
            callMinutes: defaultPlan.features.callMinutes,
            chatConversations: defaultPlan.features.chatConversations,
            automations: defaultPlan.features.automations,
            users: defaultPlan.features.users,
            customFeatures: defaultPlan.features.customFeatures || []
          }
        },
        profile: {
          profileType: 'free',
          chatConversationsLimit: defaultPlan.features.chatConversations,
          voiceMinutesLimit: defaultPlan.features.callMinutes,
          automationsLimit: defaultPlan.features.automations,
          chatConversationsUsed: 0,
          voiceMinutesUsed: 0,
          automationsUsed: 0,
          billingCycleStart: null,
          billingCycleEnd: null
        },
        usage: {
          callMinutes: 0,
          chatMessages: 0,
          conversations: 0,
          automations: 0,
          campaignSends: 0
        }
      });
    }

    // Map new format to expected frontend format (though frontend should ideally adapt to new format)
    // The previous response had: user, plan, profile, usage (flat object).
    // usageStats has { planName, currency, chatConversations: { used, limit .. }, ... }

    // Reconstruct response to match old schema as closely as possible for FE compatibility
    const User = require('../models/User').default;
    const user = await User.findById(userId).lean();

    // Get organization and plan details
    const org = await Organization.findById(user.organizationId).populate('planId').lean();
    const planData: any = org?.planId;

    // If no plan data, provide safe defaults
    const safePlanData = planData || {
      name: 'Free',
      slug: 'free',
      description: 'Free plan with basic features',
      price: 0,
      currency: 'USD',
      features: {
        callMinutes: 100,
        chatConversations: 100,
        automations: 5,
        users: 1,
        customFeatures: []
      }
    };

    res.json({
      success: true,
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        selectedProfile: user.selectedProfile || usageStats.planName // Use plan name/slug
      },
      plan: {
        _id: safePlanData._id,
        name: safePlanData.name,
        slug: safePlanData.slug,
        description: safePlanData.description,
        price: safePlanData.price,
        currency: safePlanData.currency,
        features: {
          callMinutes: safePlanData.features.callMinutes,
          chatConversations: safePlanData.features.chatConversations,
          automations: safePlanData.features.automations,
          users: safePlanData.features.users,
          customFeatures: safePlanData.features.customFeatures || []
        }
      },
      // Profile object for legacy FE support
      profile: {
        profileType: usageStats.planName,
        chatConversationsLimit: usageStats.chatConversations.limit === 'Unlimited' ? -1 : usageStats.chatConversations.limit,
        voiceMinutesLimit: usageStats.voiceMinutes.limit === 'Unlimited' ? -1 : usageStats.voiceMinutes.limit,
        automationsLimit: typeof usageStats.automations.limit === 'number' ? usageStats.automations.limit : -1,

        chatConversationsUsed: usageStats.chatConversations.used,
        voiceMinutesUsed: usageStats.voiceMinutes.used,
        automationsUsed: usageStats.automations.used,

        billingCycleStart: null, // Optional in FE usually
        billingCycleEnd: usageStats.billingCycle.end
      },
      // Usage flat object for legacy FE support
      usage: {
        callMinutes: usageStats.voiceMinutes.used,
        chatMessages: usageStats.chatConversations.used,
        automations: usageStats.automations.used,
        conversations: 0,
        campaignSends: 0
      }
    });

  } catch (error: any) {
    logger.error('Error fetching billing data:', error.message);
    next(error);
  }
});

export default router;
