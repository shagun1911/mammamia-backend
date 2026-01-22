import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import Organization from '../models/Organization';
import { usageTrackerService } from '../services/usage/usageTracker.service';
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

    // Get user with their profile
    const User = require('../models/User').default;
    const Profile = require('../models/Profile').default;
    const Plan = require('../models/Plan').default;

    const user = await User.findById(userId).lean();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's profile (for usage tracking)
    const profile = await Profile.findOne({ userId }).lean();

    // Get plan details if user has one
    let planDetails = null;
    if (user.selectedProfile) {
      planDetails = await Plan.findOne({ slug: user.selectedProfile }).lean();
    }

    // Get usage data from profile
    const usage = {
      callMinutes: profile?.voiceMinutesUsed || 0,
      chatMessages: profile?.chatConversationsUsed || 0,
      conversations: 0, // Can be calculated if needed
      automations: profile?.automationsUsed || 0,
      campaignSends: 0
    };

    logger.info(`✅ Billing data fetched for user: ${user.email}`);

    res.json({
      success: true,
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        selectedProfile: user.selectedProfile || 'free'
      },
      plan: planDetails,
      profile: profile ? {
        profileType: profile.profileType,
        chatConversationsLimit: profile.chatConversationsLimit,
        voiceMinutesLimit: profile.voiceMinutesLimit,
        chatConversationsUsed: profile.chatConversationsUsed,
        voiceMinutesUsed: profile.voiceMinutesUsed,
        automationsUsed: profile.automationsUsed || 0
      } : null,
      usage
    });
  } catch (error: any) {
    logger.error('Error fetching billing data:', error.message);
    next(error);
  }
});

export default router;
