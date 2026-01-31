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

      // Include suggested prompts for appointment templates (Fix #1 + #2 from batch call guide)
      const isAppointment = name.toLowerCase().includes('appointment') || name.toLowerCase().includes('confirm');
      const suggestions = isAppointment
        ? {
            suggested_first_message:
              "Hello! I'm calling to help you with appointments. How can I assist?",
            suggested_system_prompt: `You are a voice assistant that can book appointments and send confirmation emails.

CRITICAL - You MUST collect ALL of these before calling the tool:
1. Customer name
2. Customer email address (REQUIRED - we send confirmation to this email)
3. Appointment date
4. Appointment time

WORKFLOW:
- If the user asks to book: Ask for name, then email, then date, then time. One at a time.
- After you have ALL four (name, email, date, time): Call the \`${name}\` tool immediately.
- Do NOT say "I'll book it" and then fail - you MUST call the tool with all parameters.
- If email is missing, the tool will fail. Always ask: "And what email should we send the confirmation to?"
- Never end the call without either successfully calling the tool or clearly explaining what's missing.`
          }
        : undefined;

      const responseData = suggestions
        ? { ...(typeof template.toObject === 'function' ? template.toObject() : template), _suggestions: suggestions }
        : template;
      res.status(201).json(successResponse(responseData, 'Email template created successfully'));
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

