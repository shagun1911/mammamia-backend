import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CampaignService } from '../services/campaign.service';
import { successResponse, paginatedResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

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
      const campaign = await this.campaignService.findById(req.params.campaignId);
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
      const campaign = await this.campaignService.update(req.params.campaignId, req.body);
      res.json(successResponse(campaign, 'Campaign updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.campaignService.delete(req.params.campaignId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const campaign = await this.campaignService.cancel(req.params.campaignId);
      res.json(successResponse(campaign, 'Campaign cancelled'));
    } catch (error) {
      next(error);
    }
  };

  start = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const result = await this.campaignService.start(req.params.campaignId, userId);
      res.json(successResponse(result, 'Campaign started successfully'));
    } catch (error) {
      next(error);
    }
  };

  getAnalytics = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const analytics = await this.campaignService.getAnalytics(req.params.campaignId);
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

