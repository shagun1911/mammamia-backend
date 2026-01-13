import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { phoneSettingsService } from '../services/phoneSettings.service';
import { AppError } from '../middleware/error.middleware';
import { successResponse } from '../utils/response.util';

export class PhoneSettingsController {
  /**
   * GET /api/phone-settings
   * Get phone settings for the authenticated user
   */
  get = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const settings = await phoneSettingsService.get(userId);
      
      res.json(successResponse(settings));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/phone-settings
   * Update phone settings
   */
  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      
      console.log('[PhoneSettings Controller] Received update request');
      console.log('[PhoneSettings Controller] Request body:', JSON.stringify(req.body, null, 2));

      // Pass all fields from req.body to the service
      const settings = await phoneSettingsService.update(userId, req.body);

      console.log('[PhoneSettings Controller] Settings updated successfully');
      res.json(successResponse(settings));
    } catch (error) {
      console.error('[PhoneSettings Controller] Update failed:', error);
      next(error);
    }
  };
}

export const phoneSettingsController = new PhoneSettingsController();

