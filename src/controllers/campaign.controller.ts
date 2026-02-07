import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CampaignService } from '../services/campaign.service';
import { successResponse, paginatedResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';
import { profileService } from '../services/profile.service';

export class CampaignController {
  private campaignService: CampaignService;

  constructor() {
    this.campaignService = new CampaignService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.campaignService.findAll(
        organizationId.toString(),
        filters,
        Number(page),
        Number(limit)
      );
      res.json(paginatedResponse(
        result.items,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total
      ));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.findById(req.params.campaignId, organizationId.toString());
      res.json(successResponse(campaign));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const campaign = await this.campaignService.create(req.body);
      res.status(201).json(successResponse(campaign, 'Campaign created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.update(req.params.campaignId, req.body, organizationId.toString());
      res.json(successResponse(campaign, 'Campaign updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const result = await this.campaignService.delete(req.params.campaignId, organizationId.toString());
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.cancel(req.params.campaignId, organizationId.toString());
      res.json(successResponse(campaign, 'Campaign cancelled'));
    } catch (error) {
      next(error);
    }
  };

  start = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      // Check Credits (at least 1 to see if they are already over limit)
      const hasCredit = await profileService.checkCredits(organizationId.toString(), 'chat', 1);
      if (!hasCredit) {
        throw new AppError(403, 'LIMIT_REACHED', 'Plan limit reached. Please upgrade your plan before starting a campaign.');
      }

      const result = await this.campaignService.start(req.params.campaignId, userId, organizationId.toString());
      res.json(successResponse(result, 'Campaign started successfully'));
    } catch (error) {
      next(error);
    }
  };

  pause = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.pause(req.params.campaignId, organizationId.toString());
      res.json(successResponse(campaign, 'Campaign paused successfully'));
    } catch (error) {
      next(error);
    }
  };

  resume = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.resume(req.params.campaignId, userId, organizationId.toString());
      res.json(successResponse(campaign, 'Campaign resumed successfully'));
    } catch (error) {
      next(error);
    }
  };

  retryFailed = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.retryFailed(req.params.campaignId, userId, organizationId.toString());
      res.json(successResponse(campaign, 'Retrying failed recipients'));
    } catch (error) {
      next(error);
    }
  };

  getProgress = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const campaign = await this.campaignService.findById(req.params.campaignId, organizationId.toString());
      const progress = {
        totalRecipients: campaign.totalRecipients || 0,
        sentCount: campaign.sentCount || 0,
        deliveredCount: campaign.deliveredCount || 0,
        failedCount: campaign.failedCount || 0,
        pendingCount: campaign.pendingCount || 0,
        progress: campaign.totalRecipients
          ? Math.round(((campaign.sentCount || 0) + (campaign.failedCount || 0)) / campaign.totalRecipients * 100)
          : 0,
        status: campaign.status,
        logs: campaign.logs || []
      };
      res.json(successResponse(progress));
    } catch (error) {
      next(error);
    }
  };

  getAnalytics = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const analytics = await this.campaignService.getAnalytics(req.params.campaignId, organizationId.toString());
      res.json(successResponse(analytics));
    } catch (error) {
      next(error);
    }
  };

  getTemplates = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const templates = await this.campaignService.getTemplates();
      res.json(successResponse(templates));
    } catch (error) {
      next(error);
    }
  };
}

export const campaignController = new CampaignController();

