import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { phoneSettingsService } from '../services/phoneSettings.service';
import { AppError } from '../middleware/error.middleware';
import { successResponse } from '../utils/response.util';

export class InboundNumbersController {
  /**
   * GET /api/inbound-numbers
   * Get all inbound phone numbers for the authenticated user
   */
  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const settings = await phoneSettingsService.get(userId);
      
      const inboundNumbers = settings?.inboundPhoneNumbers || [];
      
      res.json(successResponse({
        inboundNumbers,
        count: inboundNumbers.length
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/inbound-numbers
   * Add inbound phone numbers (prevents duplicates)
   */
  add = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { phoneNumbers } = req.body;

      if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumbers array is required');
      }

      // Validate phone numbers format (E.164)
      const phoneNumberRegex = /^\+[1-9]\d{1,14}$/;
      const invalidNumbers = phoneNumbers.filter((num: string) => !phoneNumberRegex.test(num.trim()));
      
      if (invalidNumbers.length > 0) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid phone number format: ${invalidNumbers.join(', ')}. Must be in E.164 format (e.g., +1234567890)`);
      }

      // Get current settings
      const settings = await phoneSettingsService.get(userId);
      const existingNumbers = settings?.inboundPhoneNumbers || [];
      
      // Normalize phone numbers (trim and ensure unique)
      const normalizedNewNumbers = phoneNumbers.map((num: string) => num.trim());
      const uniqueNewNumbers = [...new Set(normalizedNewNumbers)];
      
      // Merge with existing numbers, preventing duplicates
      const allNumbers = [...new Set([...existingNumbers, ...uniqueNewNumbers])];
      
      // Update settings
      const updatedSettings = await phoneSettingsService.update(userId, {
        inboundPhoneNumbers: allNumbers
      });

      res.json(successResponse({
        inboundNumbers: updatedSettings.inboundPhoneNumbers || [],
        added: uniqueNewNumbers.length,
        total: allNumbers.length
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/inbound-numbers/:phoneNumber
   * Remove a specific inbound phone number
   */
  remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { phoneNumber } = req.params;

      if (!phoneNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumber parameter is required');
      }

      // Get current settings
      const settings = await phoneSettingsService.get(userId);
      const existingNumbers = settings?.inboundPhoneNumbers || [];
      
      // Remove the phone number
      const updatedNumbers = existingNumbers.filter(num => num !== phoneNumber);
      
      // Update settings
      const updatedSettings = await phoneSettingsService.update(userId, {
        inboundPhoneNumbers: updatedNumbers
      });

      res.json(successResponse({
        inboundNumbers: updatedSettings.inboundPhoneNumbers || [],
        removed: phoneNumber,
        total: updatedNumbers.length
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/inbound-numbers
   * Replace all inbound phone numbers
   */
  replace = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { phoneNumbers } = req.body;

      if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumbers array is required');
      }

      // Validate phone numbers format (E.164)
      const phoneNumberRegex = /^\+[1-9]\d{1,14}$/;
      const invalidNumbers = phoneNumbers.filter((num: string) => !phoneNumberRegex.test(num.trim()));
      
      if (invalidNumbers.length > 0) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid phone number format: ${invalidNumbers.join(', ')}. Must be in E.164 format (e.g., +1234567890)`);
      }

      // Normalize and deduplicate
      const normalizedNumbers = phoneNumbers.map((num: string) => num.trim()).filter(Boolean);
      const uniqueNumbers = [...new Set(normalizedNumbers)];
      
      // Update settings
      const updatedSettings = await phoneSettingsService.update(userId, {
        inboundPhoneNumbers: uniqueNumbers
      });

      res.json(successResponse({
        inboundNumbers: updatedSettings.inboundPhoneNumbers || [],
        total: uniqueNumbers.length
      }));
    } catch (error) {
      next(error);
    }
  };
}

export const inboundNumbersController = new InboundNumbersController();
