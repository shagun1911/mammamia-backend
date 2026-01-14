import { Request, Response, NextFunction } from 'express';
import socialIntegrationService from '../services/socialIntegration.service';
import { AppError } from '../middleware/error.middleware';
import { MetaOAuthService } from '../services/metaOAuth.service';
import { successResponse } from '../utils/response.util';

export class SocialIntegrationController {
  /**
   * Get all social integrations for the organization
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const integrations = await socialIntegrationService.getIntegrations(organizationId);
      
      res.json({
        success: true,
        data: integrations
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get specific integration by platform
   */
  async getByPlatform(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      const integration = await socialIntegrationService.getIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook'
      );

      if (!integration) {
        return res.json({
          success: true,
          data: null
        });
      }

      // Mask API key
      const response = {
        ...integration.toObject(),
        credentials: {
          ...integration.credentials,
          apiKey: '***********'
        }
      };

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Connect/Update social integration
   */
  async connect(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;
      const {
        apiKey,
        clientId,
        phoneNumberId,
        wabaId,
        instagramAccountId,
        facebookPageId
      } = req.body;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      if (!apiKey) {
        throw new AppError(400, 'MISSING_API_KEY', 'API key is required');
      }

      // Platform-specific validations
      // Note: phoneNumberId is optional for sandbox testing
      if (platform === 'whatsapp' && !phoneNumberId) {
        console.warn('[WhatsApp] Phone Number ID not provided - may be using sandbox mode');
      }

      if (platform === 'instagram' && !instagramAccountId) {
        throw new AppError(400, 'MISSING_ACCOUNT_ID', 'Instagram Account ID is required');
      }

      if (platform === 'facebook' && !facebookPageId) {
        throw new AppError(400, 'MISSING_PAGE_ID', 'Facebook Page ID is required');
      }

      const integration = await socialIntegrationService.upsertIntegration({
        organizationId,
        platform: platform as 'whatsapp' | 'instagram' | 'facebook',
        apiKey,
        clientId,
        phoneNumberId,
        wabaId,
        instagramAccountId,
        facebookPageId
      });

      // Mask API key in response
      const response = {
        ...integration.toObject(),
        credentials: {
          ...integration.credentials,
          apiKey: '***********'
        }
      };

      res.json({
        success: true,
        message: `${platform} connected successfully`,
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test connection
   */
  async testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      const isConnected = await socialIntegrationService.testConnection(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook'
      );

      res.json({
        success: true,
        connected: isConnected,
        message: isConnected 
          ? `${platform} connection is active` 
          : `${platform} connection failed`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disconnect integration
   */
  async disconnect(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      await socialIntegrationService.disconnectIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook'
      );

      res.json({
        success: true,
        message: `${platform} disconnected successfully`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete integration
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      await socialIntegrationService.deleteIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook'
      );

      res.json({
        success: true,
        message: `${platform} integration deleted successfully`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initiate OAuth flow for Meta platforms
   */
  async initiateOAuth(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      const { platform } = req.params;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      // Check if Meta App credentials are configured
      const metaAppId = process.env.META_APP_ID;
      const metaAppSecret = process.env.META_APP_SECRET;
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:5001';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      if (!metaAppId || !metaAppSecret) {
        throw new AppError(
          500,
          'CONFIGURATION_ERROR',
          'Meta App credentials not configured. Please set META_APP_ID and META_APP_SECRET environment variables.'
        );
      }

      // Create OAuth service instance
      const redirectUri = `${backendUrl}/api/v1/social-integrations/${platform}/oauth/callback`;
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId,
        appSecret: metaAppSecret,
        redirectUri
      });

      // Generate state with user info
      const state = Buffer.from(JSON.stringify({
        userId: (req as any).user?._id,
        organizationId,
        platform,
        redirectUrl: `${frontendUrl}/settings/socials`
      })).toString('base64');

      // Generate authorization URL
      const authUrl = metaOAuth.getAuthorizationUrl(platform as 'whatsapp' | 'instagram' | 'facebook', state);

      res.json(successResponse({ authUrl }, 'OAuth URL generated'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle OAuth callback from Meta
   */
  async oauthCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, state, error, error_reason, error_description } = req.query;
      const { platform } = req.params;

      // Handle OAuth errors
      if (error) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const errorMessage = error_description || error_reason || 'OAuth authorization failed';
        return res.redirect(
          `${frontendUrl}/settings/socials?error=${encodeURIComponent(errorMessage)}&platform=${platform}`
        );
      }

      if (!code || !state) {
        throw new AppError(400, 'INVALID_REQUEST', 'Missing authorization code or state');
      }

      // Decode state
      const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      const { organizationId, platform: statePlatform, redirectUrl } = stateData;

      if (platform !== statePlatform) {
        throw new AppError(400, 'INVALID_REQUEST', 'Platform mismatch');
      }

      // Get Meta App credentials
      const metaAppId = process.env.META_APP_ID;
      const metaAppSecret = process.env.META_APP_SECRET;
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:5001';

      if (!metaAppId || !metaAppSecret) {
        throw new AppError(500, 'CONFIGURATION_ERROR', 'Meta App credentials not configured');
      }

      // Create OAuth service
      const redirectUri = `${backendUrl}/api/v1/social-integrations/${platform}/oauth/callback`;
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId,
        appSecret: metaAppSecret,
        redirectUri
      });

      // Exchange code for short-lived token
      const tokenResponse = await metaOAuth.exchangeCodeForToken(code as string);
      const shortLivedToken = tokenResponse.access_token;

      // Exchange for long-lived token (60 days)
      const longLivedTokenResponse = await metaOAuth.getLongLivedToken(shortLivedToken);
      const accessToken = longLivedTokenResponse.access_token;

      // Get user's pages
      const pages = await metaOAuth.getUserPages(accessToken);

      if (pages.length === 0) {
        throw new AppError(400, 'NO_PAGES', 'No Facebook Pages found. Please create a Facebook Page first.');
      }

      // Platform-specific handling
      let integrationData: any = {
        organizationId,
        platform: platform as 'whatsapp' | 'instagram' | 'facebook',
        apiKey: accessToken, // Store access token as apiKey for compatibility
        clientId: metaAppId
      };

      if (platform === 'facebook') {
        // For Facebook, use the first page
        const selectedPage = pages[0];
        integrationData.facebookPageId = selectedPage.id;
        integrationData.credentials = {
          apiKey: accessToken,
          clientId: metaAppId,
          facebookPageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token
        };
      } else if (platform === 'instagram') {
        // For Instagram, find page with Instagram account
        let instagramAccountId: string | null = null;
        let selectedPage = pages[0];

        for (const page of pages) {
          const instagramAccounts = await metaOAuth.getInstagramAccounts(page.id, page.access_token);
          if (instagramAccounts.length > 0) {
            instagramAccountId = instagramAccounts[0].id;
            selectedPage = page;
            break;
          }
        }

        if (!instagramAccountId) {
          throw new AppError(
            400,
            'NO_INSTAGRAM_ACCOUNT',
            'No Instagram Business Account found. Please connect an Instagram account to your Facebook Page.'
          );
        }

        integrationData.instagramAccountId = instagramAccountId;
        integrationData.facebookPageId = selectedPage.id;
        integrationData.credentials = {
          apiKey: accessToken,
          clientId: metaAppId,
          instagramAccountId,
          facebookPageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token
        };
      } else if (platform === 'whatsapp') {
        // For WhatsApp, find page with WhatsApp Business Account
        let wabaId: string | null = null;
        let phoneNumberId: string | null = null;
        let selectedPage = pages[0];

        for (const page of pages) {
          const waba = await metaOAuth.getWhatsAppBusinessAccountId(page.id, page.access_token);
          if (waba) {
            wabaId = waba;
            selectedPage = page;
            // Get phone number ID
            phoneNumberId = await metaOAuth.getWhatsAppPhoneNumberId(waba, accessToken);
            break;
          }
        }

        if (!wabaId) {
          throw new AppError(
            400,
            'NO_WHATSAPP_ACCOUNT',
            'No WhatsApp Business Account found. Please set up WhatsApp Business API in Meta Business Manager.'
          );
        }

        integrationData.wabaId = wabaId;
        integrationData.phoneNumberId = phoneNumberId;
        integrationData.facebookPageId = selectedPage.id;
        integrationData.credentials = {
          apiKey: accessToken,
          clientId: metaAppId,
          phoneNumberId,
          wabaId,
          facebookPageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token
        };
      }

      // Save integration (skip verification for OAuth connections)
      await socialIntegrationService.upsertIntegration({
        ...integrationData,
        skipVerification: true // OAuth tokens are already verified by Meta
      });

      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/settings/socials?success=true&platform=${platform}`);
    } catch (error: any) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const errorMessage = error.message || 'OAuth callback failed';
      res.redirect(
        `${frontendUrl}/settings/socials?error=${encodeURIComponent(errorMessage)}&platform=${req.params.platform}`
      );
    }
  }
}

export default new SocialIntegrationController();

