import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { emailTemplateService } from '../services/emailTemplate.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

export class EmailTemplateController {
  createEmailTemplate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { name, description, subject_template, body_template, parameters } = req.body;

      // Validation
      if (!name || !name.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'name is required');
      }
      if (!description || !description.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'description is required');
      }
      if (!subject_template || !subject_template.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'subject_template is required');
      }
      if (!body_template || !body_template.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'body_template is required');
      }
      if (!Array.isArray(parameters)) {
        throw new AppError(422, 'VALIDATION_ERROR', 'parameters must be an array');
      }

      const template = await emailTemplateService.createEmailTemplate(userId, {
        name: name.trim(),
        description: description.trim(),
        subject_template: subject_template.trim(),
        body_template: body_template.trim(),
        parameters: parameters || [],
      });

      res.status(201).json(successResponse(template, 'Email template created successfully'));
    } catch (error) {
      next(error);
    }
  };

  getEmailTemplates = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const templates = await emailTemplateService.getEmailTemplatesByUserId(userId);
      res.json(successResponse(templates));
    } catch (error) {
      next(error);
    }
  };

  getEmailTemplateById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { templateId } = req.params;
      const template = await emailTemplateService.getEmailTemplateById(userId, templateId);
      
      if (!template) {
        throw new AppError(404, 'NOT_FOUND', 'Email template not found');
      }

      res.json(successResponse(template));
    } catch (error) {
      next(error);
    }
  };

  deleteEmailTemplate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { templateId } = req.params;
      await emailTemplateService.deleteEmailTemplate(userId, templateId);
      res.json(successResponse(null, 'Email template deleted successfully'));
    } catch (error) {
      next(error);
    }
  };
}

export const emailTemplateController = new EmailTemplateController();

