import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { settingsService } from '../services/settings.service';
import { successResponse } from '../utils/response.util';

export class SettingsController {
  // Public endpoint for widget settings (no auth required)
  getWidgetSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { widgetId } = req.params;
      
      // For now, get the first user's settings (in production, map widgetId to organization/user)
      // You can enhance this to fetch settings based on widgetId -> organizationId mapping
      const settings = await settingsService.getWidgetSettings(widgetId);
      
      // Return only public-safe settings (no sensitive data)
      res.json(successResponse({ 
        chatbotName: settings.chatbotName || 'Support Assistant',
        chatbotAvatar: settings.chatbotAvatar || null,
        primaryColor: settings.primaryColor || '#6366f1',
        autoReplyMessage: settings.autoReplyMessage || 'Hello! How can I help you today?'
      }));
    } catch (error) {
      next(error);
    }
  };

  getSettings = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const settings = await settingsService.getSettings(req.user!._id);
      res.json(successResponse({ settings }));
    } catch (error) {
      next(error);
    }
  };

  updateSettings = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      console.log('[Settings Update] userId:', req.user!._id);
      console.log('[Settings Update] Received data:', JSON.stringify(req.body, null, 2));
      
      const settings = await settingsService.updateSettings(req.user!._id, req.body);
      
      console.log('[Settings Update] Saved successfully');
      console.log('[Settings Update] defaultKnowledgeBaseName:', settings.defaultKnowledgeBaseName);
      
      res.json(successResponse({ settings }));
    } catch (error) {
      next(error);
    }
  };

  getOperators = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const operators = await settingsService.getOperators();
      res.json(successResponse({ operators }));
    } catch (error) {
      next(error);
    }
  };

  createOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const operator = await settingsService.createOperator(req.body);
      res.json(successResponse({ operator }, 'Operator created successfully'));
    } catch (error) {
      next(error);
    }
  };

  updateOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const operator = await settingsService.updateOperator(req.params.id, req.body);
      res.json(successResponse({ operator }, 'Operator updated successfully'));
    } catch (error) {
      next(error);
    }
  };

  deleteOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await settingsService.deleteOperator(req.params.id);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };
}

export const settingsController = new SettingsController();

