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
 * Get current user's billing information and usage
 */
router.get('/billing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.user as any)?.id;
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      return res.status(404).json({
        success: false,
        message: 'No organization found for this user'
      });
    }

    // Get organization with plan details
    const organization = await Organization.findById(organizationId)
      .populate('planId')
      .lean();

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Get usage data
    const usage = await usageTrackerService.getOrganizationUsage(organizationId.toString());

    res.json({
      success: true,
      organization: {
        _id: organization._id,
        name: organization.name,
        plan: organization.plan,
        planId: organization.planId,
        status: organization.status
      },
      usage
    });
  } catch (error: any) {
    logger.error('Error fetching billing data:', error.message);
    next(error);
  }
});

export default router;
