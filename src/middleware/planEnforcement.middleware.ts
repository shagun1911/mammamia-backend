import { Request, Response, NextFunction } from 'express';
import Organization from '../models/Organization';
import Plan from '../models/Plan';
import { usageTrackerService } from '../services/usage/usageTracker.service';
import { logger } from '../utils/logger.util';
import { AppError } from './error.middleware';

/**
 * Plan Enforcement Middleware
 * 
 * Enforces plan limits for:
 * - Call minutes
 * - Chat conversations
 * - Automations
 * 
 * Blocks requests if limits are exceeded
 */

/**
 * Middleware to check if organization has exceeded call minutes limit
 */
export const enforceCallMinutesLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      next();
      return;
    }

    // Get organization with plan
    const org = await Organization.findById(organizationId).populate('planId').lean();
    
    if (!org || !org.planId) {
      next();
      return;
    }

    const plan = org.planId as any;

    // If unlimited (-1), allow
    if (plan.features?.callMinutes === -1) {
      next();
      return;
    }

    // Get current usage
    const usage = await usageTrackerService.getOrganizationUsage(organizationId.toString());

    if (usage.callMinutes >= plan.features?.callMinutes) {
      logger.warn(`[Plan Enforcement] Organization ${organizationId} exceeded call minutes limit`);
      throw new AppError(
        403,
        'PLAN_LIMIT_EXCEEDED',
        `You have reached your plan limit of ${plan.features?.callMinutes} call minutes. Please upgrade your plan.`
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if organization has exceeded chat conversations limit
 */
export const enforceChatLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      next();
      return;
    }

    // Get organization with plan
    const org = await Organization.findById(organizationId).populate('planId').lean();
    
    if (!org || !org.planId) {
      next();
      return;
    }

    const plan = org.planId as any;

    // If unlimited (-1), allow
    if (plan.features?.chatConversations === -1) {
      next();
      return;
    }

    // Get current usage
    const usage = await usageTrackerService.getOrganizationUsage(organizationId.toString());

    if (usage.chatMessages >= plan.features?.chatConversations) {
      logger.warn(`[Plan Enforcement] Organization ${organizationId} exceeded chat conversations limit`);
      throw new AppError(
        403,
        'PLAN_LIMIT_EXCEEDED',
        `You have reached your plan limit of ${plan.features?.chatConversations} chat conversations. Please upgrade your plan.`
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if organization has exceeded automations limit
 */
export const enforceAutomationsLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      next();
      return;
    }

    // Get organization with plan
    const org = await Organization.findById(organizationId).populate('planId').lean();
    
    if (!org || !org.planId) {
      next();
      return;
    }

    const plan = org.planId as any;

    // If unlimited (-1), allow
    if (plan.features?.automations === -1) {
      next();
      return;
    }

    // Get current usage
    const usage = await usageTrackerService.getOrganizationUsage(organizationId.toString());

    if (usage.automations >= plan.features?.automations) {
      logger.warn(`[Plan Enforcement] Organization ${organizationId} exceeded automations limit`);
      throw new AppError(
        403,
        'PLAN_LIMIT_EXCEEDED',
        `You have reached your plan limit of ${plan.features?.automations} automations. Please upgrade your plan.`
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check organization plan status
 */
export const checkPlanStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      next();
      return;
    }

    // Get organization
    const org = await Organization.findById(organizationId).lean();
    
    if (!org) {
      throw new AppError(404, 'NOT_FOUND', 'Organization not found');
    }

    if (org.status === 'suspended') {
      throw new AppError(
        403,
        'ORGANIZATION_SUSPENDED',
        'Your organization has been suspended. Please contact support.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Get usage info for current organization (helper for responses)
 */
export const getUsageInfo = async (organizationId: string) => {
  try {
    const org = await Organization.findById(organizationId).populate('planId').lean();
    
    if (!org || !org.planId) {
      return null;
    }

    const plan = org.planId as any;
    const usage = await usageTrackerService.getOrganizationUsage(organizationId);
    const limits = await usageTrackerService.checkLimits(organizationId, plan);

    return {
      usage,
      limits,
      plan: {
        name: plan.name,
        slug: plan.slug
      }
    };
  } catch (error: any) {
    logger.error('[Plan Enforcement] Error getting usage info:', error.message);
    return null;
  }
};
