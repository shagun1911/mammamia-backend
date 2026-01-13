import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { inboundAgentConfigService } from '../services/inboundAgentConfig.service';
import { AppError } from '../middleware/error.middleware';

export class InboundAgentConfigController {
  /**
   * Get all inbound agent configs for a user
   */
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const configs = await inboundAgentConfigService.get(userId);
      
      res.json({
        configs: configs || []
      });
    } catch (error) {
      next(error);
    }
  }
  
  /**
   * Get inbound agent config by phone number
   */
  async getByPhoneNumber(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const { phoneNumber } = req.params;
      const config = await inboundAgentConfigService.getByPhoneNumber(userId, phoneNumber);
      
      res.json({
        config: config || null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sync inbound agent configs from various settings
   */
  async sync(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      console.log('[InboundAgentConfig Controller] Syncing configs for user:', userId);
      
      const configs = await inboundAgentConfigService.syncConfig(userId);
      
      res.json({
        message: `Inbound agent configs synced successfully (${configs.length} configs)`,
        configs
      });
    } catch (error) {
      console.error('[InboundAgentConfig Controller] Sync error:', error);
      next(error);
    }
  }

  /**
   * Update inbound agent config for a specific phone number
   */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const { calledNumber, voice_id, collections, language, agent_instruction, greeting_message } = req.body;
      
      console.log('[InboundAgentConfig Controller] ==========================================');
      console.log('[InboundAgentConfig Controller] UPDATE REQUEST RECEIVED');
      console.log('[InboundAgentConfig Controller] UserId:', userId);
      console.log('[InboundAgentConfig Controller] Request body:', JSON.stringify(req.body, null, 2));
      console.log('[InboundAgentConfig Controller] ==========================================');
      
      if (!calledNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'calledNumber is required');
      }

      const config = await inboundAgentConfigService.update(userId, calledNumber, {
        voice_id,
        collections,
        language,
        agent_instruction,
        greeting_message
      });

      console.log('[InboundAgentConfig Controller] Update successful');
      console.log('[InboundAgentConfig Controller] Updated config:', {
        _id: config._id,
        calledNumber: config.calledNumber,
        language: config.language,
        greeting_message: config.greeting_message
      });

      res.json({
        message: 'Inbound agent config updated successfully',
        config
      });
    } catch (error) {
      console.error('[InboundAgentConfig Controller] Update error:', error);
      next(error);
    }
  }

  /**
   * Delete inbound agent config for a specific phone number
   */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const { phoneNumber } = req.params;
      if (!phoneNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'phoneNumber is required');
      }

      await inboundAgentConfigService.delete(userId, phoneNumber);

      res.json({
        message: 'Inbound agent config deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
  
  /**
   * Delete all inbound agent configs for a user
   */
  async deleteAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      await inboundAgentConfigService.deleteAll(userId);

      res.json({
        message: 'All inbound agent configs deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

export const inboundAgentConfigController = new InboundAgentConfigController();

