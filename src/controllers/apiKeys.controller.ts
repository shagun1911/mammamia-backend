import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { apiKeysService } from '../services/apiKeys.service';

export class ApiKeysController {
  /**
   * Get API keys for authenticated user
   */
  async getApiKeys(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id || req.user?.id;
      
      console.log('[API Keys] Get request from user:', userId);
      
      if (!userId) {
        return res.status(401).json({ 
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
        });
      }

      const apiKeys = await apiKeysService.getApiKeys(String(userId));
      
      console.log('[API Keys] Retrieved:', apiKeys ? 'Found' : 'Not found');
      res.json({
        success: true,
        data: apiKeys
      });
    } catch (error: any) {
      console.error('[API Keys] Error:', error);
      // If not found, return empty response instead of error
      if (error.statusCode === 404) {
        return res.json({
          success: true,
          data: null
        });
      }
      next(error);
    }
  }

  /**
   * Update API keys
   */
  async updateApiKeys(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id || req.user?.id;
      
      console.log('[API Keys] Update request from user:', userId, 'Data:', { ...req.body, apiKey: req.body.apiKey ? '***' : undefined });
      
      if (!userId) {
        return res.status(401).json({ 
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
        });
      }

      const apiKeys = await apiKeysService.updateApiKeys(String(userId), req.body);
      
      console.log('[API Keys] Updated successfully');
      res.json({
        success: true,
        data: apiKeys
      });
    } catch (error) {
      console.error('[API Keys] Update error:', error);
      next(error);
    }
  }

  /**
   * Delete API keys
   */
  async deleteApiKeys(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id || req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await apiKeysService.deleteApiKeys(String(userId));
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const apiKeysController = new ApiKeysController();

