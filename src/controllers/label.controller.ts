import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LabelService } from '../services/label.service';
import { successResponse } from '../utils/response.util';

export class LabelController {
  private labelService: LabelService;

  constructor() {
    this.labelService = new LabelService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const labels = await this.labelService.findAll();
      res.json(successResponse(labels));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const label = await this.labelService.create(req.body);
      res.status(201).json(successResponse(label, 'Label created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const label = await this.labelService.update(req.params.labelId, req.body);
      res.json(successResponse(label, 'Label updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.labelService.delete(req.params.labelId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };
}

export const labelController = new LabelController();

