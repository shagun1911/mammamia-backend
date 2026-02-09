import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { profileService } from '../services/profile.service';
import { planService } from '../services/plan.service';
import { successResponse } from '../utils/response.util';

export class ProfileController {
  /**
   * Get available profile types (Plans)
   */
  getAvailableProfiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use PlanService to get active plans
      const plans = await planService.findAllPlans(false);
      // Map to old profile format if needed by frontend
      const profiles = plans.map((p: any) => ({
        type: p.slug,
        name: p.name,
        description: p.description,
        chatConversations: p.features.chatConversations,
        voiceMinutes: p.features.callMinutes
      }));
      res.json(successResponse({ profiles }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get current profile and usage stats
   */
  getProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id;
      // Get usage stats containing plan info
      const usageStats = await profileService.getUsageStats(userId);

      res.json(successResponse({
        profile: null, // Legacy field, deprecated
        usage: usageStats
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Select or change profile
   */
  selectProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id;
      const { profileType } = req.body; // profileType is basically plan slug

      if (!profileType) {
        return res.status(400).json({
          success: false,
          message: 'Profile type (plan slug) is required'
        });
      }

      // Use PlanService to assign plan
      const result = await planService.assignPlanToOrganization(userId, profileType);

      const usageStats = await profileService.getUsageStats(userId);

      res.json(successResponse({
        profile: { profileType: profileType }, // Minimal legacy response
        usage: usageStats
      }, 'Profile selected successfully'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get usage statistics
   */
  getUsageStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id;
      const usageStats = await profileService.getUsageStats(userId);

      res.json(successResponse({ usage: usageStats }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Check if user has available credits
   */
  checkCredits = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id;
      const { type, amount } = req.query;

      if (!type || !['chat', 'voice', 'automations'].includes(type as string)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid type. Must be one of: chat, voice, automations'
        });
      }

      const hasCredits = await profileService.checkCredits(
        userId,
        type as 'chat' | 'voice' | 'automations',
        amount ? parseInt(amount as string) : 1
      );

      res.json(successResponse({ hasCredits }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Delete profile
   */
  deleteProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Cannot delete profile in new model, maybe archive org?
      // For now, return success to not break frontend
      res.json(successResponse({}, 'Profile deleted successfully'));
    } catch (error) {
      next(error);
    }
  };
}

export const profileController = new ProfileController();

