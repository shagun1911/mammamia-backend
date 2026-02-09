import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import { logger } from '../utils/logger.util';

/**
 * Usage Enforcement Middleware
 * 
 * Enforces plan limits stored on User.subscription.
 * Blocks requests when usage exceeds limits.
 * 
 * Usage types: 'conversations' | 'minutes' | 'automations'
 */
export function requireUsage(type: 'conversations' | 'minutes' | 'automations') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      if (!user) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      // Check if user has subscription data, initialize ONLY if subscription or plan is truly missing
      // NEVER overwrite an existing subscription.plan
      if (!user.subscription || !user.subscription.plan) {
        // Initialize with free plan limits
        const { getPlanLimits } = await import('../config/planLimits');
        const freeLimits = getPlanLimits('free') || { conversations: 20, minutes: 20, automations: 5 };
        
        // Initialize subscription on user document - replace entire object
        const User = (await import('../models/User')).default;
        await User.findByIdAndUpdate(user._id, {
          subscription: {
            plan: 'free',
            limits: freeLimits,
            usage: {
              conversations: 0,
              minutes: 0,
              automations: 0
            },
            activatedAt: null
          }
        });
        
        // Reload user to get updated subscription
        const updatedUser = await User.findById(user._id);
        if (updatedUser) {
          (req as any).user = updatedUser;
          user.subscription = updatedUser.subscription;
        } else {
          throw new AppError(
            403,
            'LIMIT_EXCEEDED',
            'No active subscription. Please upgrade your plan.'
          );
        }
      }

      const used = user.subscription.usage?.[type] || 0;
      const limit = user.subscription.limits?.[type] || 0;

      // Check if limit is exceeded
      if (used >= limit) {
        logger.warn(`[Usage Enforcement] User ${user._id} exceeded ${type} limit`, {
          used,
          limit,
          plan: user.subscription.plan
        });
        
        throw new AppError(
          403,
          'LIMIT_EXCEEDED',
          `You have reached your ${type} limit (${used}/${limit}). Please upgrade your plan.`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check usage without blocking (for informational purposes)
 */
export function checkUsage(type: 'conversations' | 'minutes' | 'automations') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      if (!user || !user.subscription) {
        // Attach usage info to request for frontend
        (req as any).usageInfo = {
          hasSubscription: false,
          remaining: { conversations: 0, minutes: 0, automations: 0 }
        };
        return next();
      }

      const usage = user.subscription.usage || { conversations: 0, minutes: 0, automations: 0 };
      const limits = user.subscription.limits || { conversations: 20, minutes: 20, automations: 5 };

      // Attach usage info to request
      (req as any).usageInfo = {
        hasSubscription: true,
        plan: user.subscription.plan,
        used: usage,
        limits: limits,
        remaining: {
          conversations: Math.max(0, limits.conversations - usage.conversations),
          minutes: Math.max(0, limits.minutes - usage.minutes),
          automations: Math.max(0, limits.automations - usage.automations)
        }
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

