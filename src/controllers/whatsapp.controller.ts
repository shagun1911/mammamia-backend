import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import SocialIntegration from '../models/SocialIntegration';
import { WhatsAppService } from '../services/whatsapp.service';
import { profileService } from '../services/profile.service';

const whatsappService = new WhatsAppService();

export class WhatsAppController {
  /**
   * Send WhatsApp template message
   * POST /api/v1/whatsapp/send-template
   */
  async sendTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Get organizationId from authenticated user
      const organizationId = req.user?.organizationId || req.user?._id;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      // Check Credits
      const hasCredit = await profileService.checkCredits(organizationId.toString(), 'chat', 1);
      if (!hasCredit) {
        throw new AppError(403, 'LIMIT_REACHED', 'Chat messages limit reached. Please upgrade your plan.');
      }

      // Validate request body
      const { phoneNumberId, to, templateName, languageCode, components } = req.body;

      if (!phoneNumberId || !to || !templateName) {
        throw new AppError(
          400,
          'MISSING_PARAMETERS',
          'phoneNumberId, to, and templateName are required'
        );
      }

      // CRITICAL: languageCode is required (no defaults, no fallbacks)
      if (!languageCode || languageCode.trim() === '') {
        throw new AppError(
          400,
          'MISSING_LANGUAGE_CODE',
          'languageCode is required and must come from the selected template metadata. Do not use defaults.'
        );
      }

      // Fetch WhatsApp SocialIntegration
      const integration = await SocialIntegration.findOne({
        organizationId: organizationId,
        platform: 'whatsapp',
        status: 'connected'
      });

      if (!integration) {
        throw new AppError(
          404,
          'INTEGRATION_NOT_FOUND',
          'WhatsApp integration not found or not connected. Please connect WhatsApp first.'
        );
      }

      // Get decrypted USER access token
      const userAccessToken = (integration as any).getDecryptedApiKey();

      if (!userAccessToken) {
        throw new AppError(
          500,
          'MISSING_ACCESS_TOKEN',
          'Access token not found in integration. Please reconnect WhatsApp.'
        );
      }

      // Use phoneNumberId from request or fallback to integration
      const finalPhoneNumberId = phoneNumberId || integration.credentials?.phoneNumberId;

      if (!finalPhoneNumberId) {
        throw new AppError(
          400,
          'MISSING_PHONE_NUMBER_ID',
          'phoneNumberId is required. Either provide it in the request or ensure it is stored in the integration.'
        );
      }

      // Send template message via Graph API
      const result = await whatsappService.sendTemplateMessage(userAccessToken, {
        phoneNumberId: finalPhoneNumberId,
        to: to,
        templateName: templateName,
        languageCode: languageCode, // No fallback - already validated above
        components: components || []
      });

      // Return clean response
      res.json({
        success: result.success,
        message_id: result.message_id,
        ...(process.env.NODE_ENV !== 'production' && { raw: result.raw })
      });

    } catch (error: any) {
      // Handle AppError with proper error details
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            message: error.message,
            code: (error as any)?.errorCode ?? (error as any)?.code ?? null,
            ...(error.details && { details: error.details })
          }
        });
      }

      // Handle Graph API errors
      if (error.response?.data?.error) {
        const graphError = error.response.data.error;
        return res.status(error.response.status || 500).json({
          success: false,
          error: {
            message: graphError.message || 'Failed to send WhatsApp template message',
            code: graphError.code,
            ...(graphError.error_subcode && { details: { error_subcode: graphError.error_subcode } })
          },
          ...(process.env.NODE_ENV !== 'production' && { raw: error.response.data })
        });
      }

      // Generic error
      next(error);
    }
  }

  /**
   * Get WhatsApp templates using connected integration (automatic mode)
   * GET /api/v1/whatsapp/templates
   */
  async getTemplates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const integration = await SocialIntegration.findOne({
        organizationId,
        platform: 'whatsapp',
        status: 'connected'
      });

      if (!integration) {
        throw new AppError(
          404,
          'INTEGRATION_NOT_FOUND',
          'WhatsApp integration not found or not connected. Please connect WhatsApp first.'
        );
      }

      const accessToken = (integration as any).getDecryptedApiKey();
      const wabaId = integration.credentials?.wabaId;

      if (!accessToken || !wabaId) {
        throw new AppError(
          400,
          'MISSING_CREDENTIALS',
          'WhatsApp access token or WABA ID missing. Please reconnect WhatsApp.'
        );
      }

      const metaUrl = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;

      const response = await axios.get(metaUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 100
        }
      });

      res.json({
        success: true,
        data: response.data
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            message: error.message,
            code: (error as any)?.errorCode ?? (error as any)?.code ?? null,
            ...(error.details && { details: error.details })
          }
        });
      }

      if (error.response?.data) {
        return res.status(error.response.status || 500).json({
          success: false,
          error: error.response.data
        });
      }

      next(error);
    }
  }

  /**
   * Get WhatsApp templates using manual credentials (manual mode)
   * POST /api/v1/whatsapp/templates
   * body: { accessToken, wabaId }
   */
  async getTemplatesManual(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { accessToken, wabaId } = req.body || {};

      if (!accessToken || !wabaId) {
        throw new AppError(
          400,
          'MISSING_PARAMETERS',
          'accessToken and wabaId are required to fetch templates in manual mode'
        );
      }

      const metaUrl = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;

      const response = await axios.get(metaUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 100
        }
      });

      res.json({
        success: true,
        data: response.data
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            message: error.message,
            code: (error as any)?.errorCode ?? (error as any)?.code ?? null,
            ...(error.details && { details: error.details })
          }
        });
      }

      if (error.response?.data) {
        return res.status(error.response.status || 500).json({
          success: false,
          error: error.response.data
        });
      }

      next(error);
    }
  }
}

export default new WhatsAppController();

