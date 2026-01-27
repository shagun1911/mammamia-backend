import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { inboundNumberService } from '../services/inboundNumber.service';
import { AppError } from '../middleware/error.middleware';
import { successResponse } from '../utils/response.util';

export class InboundNumberController {
  /**
   * GET /api/v1/inbound-numbers
   * Get all inbound phone numbers for the authenticated user
   * This is the SOURCE OF TRUTH for inbound numbers
   */
  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      
      console.log(`📞 [InboundNumber Controller] GET /inbound-numbers - User: ${userId}`);
      
      const inboundNumbers = await inboundNumberService.getAll(userId);
      const phoneNumbers = inboundNumbers.map(n => n.phoneNumber);
      
      // Return full records with all fields as requested
      const numbers = inboundNumbers.map(n => ({
        phoneNumber: n.phoneNumber,
        trunkId: n.trunkId,
        provider: n.provider,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      }));
      
      console.log(`✅ [InboundNumber Controller] Found ${phoneNumbers.length} inbound number(s):`, phoneNumbers);
      
      res.json(successResponse({
        inboundNumbers: phoneNumbers,
        numbers: numbers, // Full records as requested
        count: phoneNumbers.length
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/inbound-numbers
   * Create inbound phone numbers
   * Checks for duplicates and reuses trunkId if exists
   */
  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { phoneNumbers, trunkId, provider } = req.body;

      if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumbers array is required');
      }

      if (!trunkId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'trunkId is required');
      }

      // Validate phone numbers format (E.164)
      const phoneNumberRegex = /^\+[1-9]\d{1,14}$/;
      const invalidNumbers = phoneNumbers.filter((num: string) => !phoneNumberRegex.test(num.trim()));
      
      if (invalidNumbers.length > 0) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid phone number format: ${invalidNumbers.join(', ')}. Must be in E.164 format (e.g., +1234567890)`);
      }

      console.log(`📞 [InboundNumber Controller] POST /inbound-numbers - Creating ${phoneNumbers.length} number(s)`);
      console.log(`📞 [InboundNumber Controller] TrunkId: ${trunkId}, Provider: ${provider || 'livekit'}`);

      // Normalize phone numbers
      const normalizedNumbers = phoneNumbers.map((num: string) => num.trim());
      const uniqueNumbers = [...new Set(normalizedNumbers)];

      // Create or get existing numbers
      const result = await inboundNumberService.createMultiple(
        userId,
        uniqueNumbers,
        trunkId,
        provider || 'livekit'
      );

      const phoneNumbersList = result.inboundNumbers.map(n => n.phoneNumber);
      const createdCount = result.created || 0;
      const reusedCount = result.reused || 0;
      const totalCount = phoneNumbersList.length;

      console.log(`✅ [InboundNumber Controller] Created ${createdCount} new, reused ${reusedCount} existing inbound numbers`);

      // Ensure we never return undefined values
      res.json(successResponse({
        inboundNumbers: phoneNumbersList,
        created: createdCount,
        reused: reusedCount,
        total: totalCount
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/inbound-numbers/:phoneNumber
   * Remove a specific inbound phone number
   */
  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { phoneNumber } = req.params;

      if (!phoneNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumber parameter is required');
      }

      console.log(`🗑️ [InboundNumber Controller] DELETE /inbound-numbers/${phoneNumber}`);

      await inboundNumberService.delete(userId, phoneNumber);

      res.json(successResponse({
        message: 'Inbound number deleted successfully',
        phoneNumber
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/inbound-numbers
   * Clear ALL inbound data for the authenticated user
   * This will:
   * - Delete all InboundNumber records
   * - Delete all InboundAgentConfig records (except chatbot default)
   * - Clear PhoneSettings.inboundPhoneNumbers array
   * - Clear inbound trunk info from PhoneSettings
   */
  deleteAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;

      console.log(`🗑️ [InboundNumber Controller] DELETE /inbound-numbers (clear all) - User: ${userId}`);

      // Delete all InboundNumber records
      await inboundNumberService.deleteAll(userId);
      console.log('✅ [InboundNumber Controller] Deleted all InboundNumber records');

      // Delete all InboundAgentConfig records (except chatbot default with empty calledNumber)
      const { inboundAgentConfigService } = await import('../services/inboundAgentConfig.service');
      await inboundAgentConfigService.deleteAll(userId);
      console.log('✅ [InboundNumber Controller] Deleted all InboundAgentConfig records');

      // Clear PhoneSettings inbound data
      const PhoneSettings = (await import('../models/PhoneSettings')).default;
      await PhoneSettings.findOneAndUpdate(
        { userId },
        {
          $set: {
            inboundPhoneNumbers: [],
            inboundTrunkId: '',
            inboundTrunkName: '',
            inboundDispatchRuleId: '',
            inboundDispatchRuleName: ''
          }
        }
      );
      console.log('✅ [InboundNumber Controller] Cleared PhoneSettings inbound data');

      res.json(successResponse({
        message: 'All inbound data cleared successfully',
        cleared: {
          inboundNumbers: true,
          inboundConfigs: true,
          phoneSettings: true
        }
      }));
    } catch (error) {
      next(error);
    }
  };
}

export const inboundNumberController = new InboundNumberController();
