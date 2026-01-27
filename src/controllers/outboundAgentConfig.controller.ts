import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { outboundAgentConfigService } from '../services/outboundAgentConfig.service';
import { AppError } from '../middleware/error.middleware';

export class OutboundAgentConfigController {
  /**
   * Get all outbound agent configs for the authenticated user
   */
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      console.log(`📞 [OutboundAgentConfig Controller] GET /outbound-agent-config - User: ${userId}`);

      const configs = await outboundAgentConfigService.getAll(userId);
      console.log(`✅ [OutboundAgentConfig Controller] Found ${configs.length} outbound config(s)`);
      
      res.json({
        configs: configs || []
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get config for a specific outbound number
   */
  async getByOutboundNumber(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { outboundNumber } = req.params;
      
      if (!outboundNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Outbound number is required');
      }

      console.log(`📞 [OutboundAgentConfig Controller] GET /outbound-agent-config/${outboundNumber} - User: ${userId}`);
      const config = await outboundAgentConfigService.getByOutboundNumber(userId, outboundNumber);
      console.log(`✅ [OutboundAgentConfig Controller] Config ${config ? 'found' : 'not found'} for ${outboundNumber}`);
      
      res.json({
        config: config || null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create or update outbound agent config
   */
  async createOrUpdate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { outboundNumber } = req.params;
      
      if (!outboundNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Outbound number is required');
      }

      console.log(`📞 [OutboundAgentConfig Controller] PUT /outbound-agent-config/${outboundNumber} - User: ${userId}`);
      console.log(`📞 [OutboundAgentConfig Controller] Request body:`, JSON.stringify(req.body, null, 2));

      const config = await outboundAgentConfigService.createOrUpdate(userId, outboundNumber, req.body);
      console.log(`✅ [OutboundAgentConfig Controller] Saved config for ${outboundNumber}`);
      
      // Return wrapped response to match frontend expectations
      res.json({
        config: config
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update outbound agent config
   */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { outboundNumber } = req.params;
      
      if (!outboundNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Outbound number is required');
      }

      const config = await outboundAgentConfigService.update(userId, outboundNumber, req.body);
      res.json({
        config: config
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete outbound agent config
   */
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id?.toString() || req.user!.id;
      const { outboundNumber } = req.params;
      
      if (!outboundNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Outbound number is required');
      }

      await outboundAgentConfigService.delete(userId, outboundNumber);
      res.json({ message: 'Outbound agent config deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export const outboundAgentConfigController = new OutboundAgentConfigController();
