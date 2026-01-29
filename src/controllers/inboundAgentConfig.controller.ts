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

  /**
   * Test inbound call
   * POST /api/v1/inbound-agent-config/test-inbound-call
   */
  async testInboundCall(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const { calledNumber } = req.body;

      if (!calledNumber) {
        throw new AppError(400, 'VALIDATION_ERROR', 'calledNumber is required');
      }

      // Get inbound agent config for this phone number
      let config = await inboundAgentConfigService.getByPhoneNumber(userId, calledNumber);
      
      if (!config) {
        // Try to sync config first - this will create configs if phone numbers exist
        console.log('[Test Inbound Call] No config found, attempting to sync...');
        await inboundAgentConfigService.syncConfig(userId);
        config = await inboundAgentConfigService.getByPhoneNumber(userId, calledNumber);
        
        if (!config) {
          throw new AppError(404, 'NOT_FOUND', `No inbound agent config found for phone number: ${calledNumber}. Please configure inbound phone numbers in Settings → Phone Settings.`);
        }
      }

      // Prepare request body for Python backend
      const requestBody: any = {
        calledNumber: config.calledNumber,
        language: config.language || 'en',
        voice_id: config.voice_id || '21m00Tcm4TlvDq8ikWAM',
        agent_instruction: config.agent_instruction || 'You are a helpful assistant',
        collections: config.collections || [],
        greeting_message: config.greeting_message || 'Hello! How can I help you today?'
      };

      // Add e-commerce credentials if available
      if (config.ecommerce_credentials) {
        requestBody.ecommerce_credentials = config.ecommerce_credentials;
        console.log('[Test Inbound Call] E-commerce credentials included:', {
          platform: config.ecommerce_credentials.platform,
          base_url: config.ecommerce_credentials.base_url
        });
      }

      // Add escalation condition if provided
      if (req.body.escalation_condition) {
        requestBody.escalation_condition = req.body.escalation_condition;
      }

      // Use PYTHON_API_URL if available (for elvenlabs-voiceagent), otherwise fall back to COMM_API_URL
      const COMM_API = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';
      const testUrl = `${COMM_API}/calls/inbound`;

      console.log('\n========== TEST INBOUND CALL ==========');
      console.log('📞 [Test Inbound Call] URL:', testUrl);
      console.log('📦 [Test Inbound Call] Request Body:', JSON.stringify({
        ...requestBody,
        ecommerce_credentials: requestBody.ecommerce_credentials ? {
          ...requestBody.ecommerce_credentials,
          api_key: requestBody.ecommerce_credentials.api_key ? `${requestBody.ecommerce_credentials.api_key.substring(0, 10)}...***` : undefined,
          api_secret: requestBody.ecommerce_credentials.api_secret ? '***hidden***' : undefined
        } : undefined
      }, null, 2));
      console.log('========================================\n');

      const axios = require('axios');
      const response = await axios.post(testUrl, requestBody, {
        timeout: 360000 // 6 minutes
      });

      console.log('\n========== TEST INBOUND CALL - RESPONSE ==========');
      console.log('✅ [Test Inbound Call] Response:', JSON.stringify(response.data, null, 2));
      console.log('==================================================\n');

      res.json({
        success: true,
        message: 'Inbound call test initiated successfully',
        data: response.data,
        config: {
          calledNumber: config.calledNumber,
          language: config.language,
          voice_id: config.voice_id,
          collections: config.collections,
          has_ecommerce_credentials: !!config.ecommerce_credentials
        }
      });
    } catch (error: any) {
      console.error('[Test Inbound Call] Error:', error.response?.data || error.message);
      next(error);
    }
  }
}

export const inboundAgentConfigController = new InboundAgentConfigController();

