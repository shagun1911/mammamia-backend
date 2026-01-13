import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { TemplateService } from '../services/template.service';
import { successResponse } from '../utils/response.util';

export class TemplateController {
  private templateService: TemplateService;

  constructor() {
    this.templateService = new TemplateService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const templates = await this.templateService.findAll(req.user._id);
      res.json(successResponse(templates));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const template = await this.templateService.create(req.body, req.user._id);
      res.status(201).json(successResponse(template, 'Template created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const template = await this.templateService.update(
        req.params.templateId,
        req.body,
        req.user._id
      );
      res.json(successResponse(template, 'Template updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.templateService.delete(req.params.templateId, req.user._id);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };
}

export const templateController = new TemplateController();

