import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { profileService } from '../services/profile.service';
import { successResponse } from '../utils/response.util';

export class ProfileController {
  /**
   * Get available profile types
   */
  getAvailableProfiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const profiles = profileService.getAvailableProfiles();
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
      const profile = await profileService.get(userId);
      const usageStats = await profileService.getUsageStats(userId);
      
      res.json(successResponse({ 
        profile,
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
      const { profileType } = req.body;

      if (!profileType || !['mileva', 'nobel', 'aistein'].includes(profileType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid profile type. Must be one of: mileva, nobel, aistein'
        });
      }

      const profile = await profileService.selectProfile(userId, profileType);
      const usageStats = await profileService.getUsageStats(userId);

      res.json(successResponse({ 
        profile,
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

      if (!type || !['chat', 'voice'].includes(type as string)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid type. Must be one of: chat, voice'
        });
      }

      const hasCredits = await profileService.checkCredits(
        userId,
        type as 'chat' | 'voice',
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
      const userId = req.user!._id;
      await profileService.delete(userId);
      
      res.json(successResponse({}, 'Profile deleted successfully'));
    } catch (error) {
      next(error);
    }
  };
}

export const profileController = new ProfileController();

