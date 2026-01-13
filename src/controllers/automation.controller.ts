import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AutomationService } from '../services/automation.service';
import { successResponse, paginatedResponse } from '../utils/response.util';

export class AutomationController {
  private automationService: AutomationService;

  constructor() {
    this.automationService = new AutomationService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const automations = await this.automationService.findAll();
      res.json(successResponse(automations));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const automation = await this.automationService.findById(req.params.automationId);
      res.json(successResponse(automation));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const automation = await this.automationService.create(req.body);
      res.status(201).json(successResponse(automation, 'Automation created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const automation = await this.automationService.update(req.params.automationId, req.body);
      res.json(successResponse(automation, 'Automation updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.automationService.delete(req.params.automationId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  toggle = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { isActive } = req.body;
      const automation = await this.automationService.toggle(req.params.automationId, isActive);
      res.json(successResponse(automation, `Automation ${isActive ? 'activated' : 'deactivated'}`));
    } catch (error) {
      next(error);
    }
  };

  getExecutionLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await this.automationService.getExecutionLogs(
        req.params.automationId,
        Number(page),
        Number(limit),
        filters
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

  test = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.automationService.testAutomation(
        req.params.automationId,
        req.body.testData
      );
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  trigger = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.automationService.triggerAutomation(
        req.params.automationId,
        req.body.triggerData,
        { userId: req.user?.userId }
      );
      res.json(successResponse(result, 'Automation triggered successfully'));
    } catch (error) {
      next(error);
    }
  };

  triggerByEvent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { event, eventData } = req.body;
      const result = await this.automationService.triggerByEvent(
        event,
        eventData,
        { userId: req.user?.userId }
      );
      res.json(successResponse(result, `${result.length} automation(s) triggered`));
    } catch (error) {
      next(error);
    }
  };
}

export const automationController = new AutomationController();

