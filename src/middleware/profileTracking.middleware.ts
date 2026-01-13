import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { profileService } from '../services/profile.service';
import { AppError } from './error.middleware';

/**
 * Middleware to check if user has available credits before allowing action
 */
export const checkCreditsMiddleware = (type: 'chat' | 'voice', amount: number = 1) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id;

      if (!userId) {
        return next(new AppError(401, 'UNAUTHORIZED', 'User not authenticated'));
      }

      const hasCredits = await profileService.checkCredits(userId, type, amount);

      if (!hasCredits) {
        const usageStats = await profileService.getUsageStats(userId);
        return next(new AppError(
          403,
          'INSUFFICIENT_CREDITS',
          `Insufficient ${type} credits. You have reached your plan limit. Please upgrade your plan.`,
          { usage: usageStats }
        ));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Helper function to track usage (call this after successful action)
 */
export const trackUsage = async (userId: string, type: 'chat' | 'voice', amount: number = 1) => {
  try {
    await profileService.useCredits(userId, type, amount);
  } catch (error) {
    console.error('[Usage Tracking] Error tracking usage:', error);
    // Don't throw error, just log it - we don't want to break the flow
  }
};

