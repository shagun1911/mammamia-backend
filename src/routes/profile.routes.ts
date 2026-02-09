import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { profileController } from '../controllers/profile.controller';
import { profileService } from '../services/profile.service';
import { logger } from '../utils/logger.util';
import User from '../models/User';
import Organization from '../models/Organization';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/profile/billing
 * Unified billing and usage endpoint
 */
router.get('/billing', async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const usageStats = await profileService.getUsageStats(userId);

    // If usageStats returns null (no organization linked), handle it
    if (!usageStats) {
      const user = await User.findById(userId).lean();
      return res.json({
        success: true,
        user: {
          _id: user?._id,
          email: user?.email,
          firstName: user?.firstName,
          lastName: user?.lastName,
          selectedProfile: 'free'
        },
        plan: {
          name: 'Free',
          slug: 'free',
          features: {
            callMinutes: 20,
            chatConversations: 20,
            automations: 5
          }
        },
        usage: {
          callMinutes: 0,
          chatMessages: 0,
          automations: 0
        }
      });
    }

    // Modern standardized response
    const user = await User.findById(userId).lean();
    const org = await Organization.findById(user?.organizationId).populate('planId').lean();
    const plan: any = org?.planId;

    res.json({
      success: true,
      user: {
        _id: user?._id,
        email: user?.email,
        firstName: user?.firstName,
        lastName: user?.lastName,
        selectedProfile: user?.selectedProfile || usageStats.planSlug
      },
      plan: plan || {
        name: usageStats.planName,
        slug: usageStats.planSlug,
        features: {
          callMinutes: usageStats.voiceMinutesLimit,
          chatConversations: usageStats.chatConversationsLimit,
          automations: usageStats.automationsLimit
        }
      },
      // Profile and Usage both return SAME data now
      profile: usageStats,
      usage: usageStats
    });

  } catch (error: any) {
    logger.error('Error fetching billing data:', error.message);
    next(error);
  }
});

/**
 * GET /api/v1/profile/usage
 * Backward compatibility route for Profile page
 */
router.get('/usage', profileController.getUsageStats);

/**
 * GET /api/v1/profile/select
 * Get available plans
 */
router.get('/select', profileController.getAvailableProfiles);

/**
 * POST /api/v1/profile/select
 * Change plan
 */
router.post('/select', profileController.selectProfile);

/**
 * GET /api/v1/profile/check-credits
 */
router.get('/check-credits', profileController.checkCredits);

/**
 * DELETE /api/v1/profile
 */
router.delete('/', profileController.deleteProfile);

export default router;
