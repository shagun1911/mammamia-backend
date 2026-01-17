import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
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
   * 
   * This endpoint ONLY validates env vars and generates OAuth URL.
   * All token exchange and resource fetching happens in the callback.
   */
  async initiateOAuth(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Validate authentication
      if (!req.user) {
        console.error('[Meta OAuth Initiate] No user in request');
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Validate user ID
      if (!req.user._id) {
        console.error('[Meta OAuth Initiate] User ID is missing:', req.user);
        throw new AppError(401, 'UNAUTHORIZED', 'User ID is missing');
      }

      const organizationId = req.user.organizationId || req.user._id;
      const { platform } = req.params;

      console.log('[Meta OAuth Initiate] Request:', {
        platform,
        userId: req.user._id?.toString(),
        organizationId: organizationId?.toString(),
        hasUser: !!req.user
      });

      // Validate platform
      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', `Invalid platform: ${platform}. Must be one of: whatsapp, instagram, facebook`);
      }

      // Fail-fast validation: Check all required environment variables
      const metaAppId = process.env.META_APP_ID;
      const metaAppSecret = process.env.META_APP_SECRET;
      const backendUrl = process.env.BACKEND_URL;
      const frontendUrl = process.env.FRONTEND_URL;

      const missingVars: string[] = [];
      if (!metaAppId) missingVars.push('META_APP_ID');
      if (!metaAppSecret) missingVars.push('META_APP_SECRET');
      if (!backendUrl) missingVars.push('BACKEND_URL');
      if (!frontendUrl) missingVars.push('FRONTEND_URL');

      if (missingVars.length > 0) {
        console.error('[Meta OAuth Initiate] Missing env vars:', missingVars);
        throw new AppError(
          500,
          'CONFIGURATION_ERROR',
          `Missing required environment variables: ${missingVars.join(', ')}. Please configure these in your backend .env file.`
        );
      }

      // Build redirect URI - must match Meta App settings exactly
      const redirectUri = `${backendUrl}/api/v1/social-integrations/${platform}/oauth/callback`;
      console.log('[Meta OAuth Initiate] Redirect URI:', redirectUri);

      // Initialize OAuth service (metaAppId and metaAppSecret are guaranteed to exist after validation above)
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId!,
        appSecret: metaAppSecret!,
        redirectUri
      });

      // Generate state with user info for callback verification
      const stateData = {
        userId: req.user._id.toString(),
        organizationId: organizationId.toString(),
        platform,
        redirectUrl: `${frontendUrl}/settings/socials`
      };

      console.log('[Meta OAuth Initiate] State data:', {
        userId: stateData.userId,
        organizationId: stateData.organizationId,
        platform: stateData.platform
      });

      const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

      // Generate Meta OAuth authorization URL
      const authUrl = metaOAuth.getAuthorizationUrl(platform as 'whatsapp' | 'instagram' | 'facebook', state);

      console.log('[Meta OAuth Initiate] Generated auth URL successfully for platform:', platform);
      console.log('[Meta OAuth Initiate] Auth URL:', authUrl.substring(0, 100) + '...');

      // Return response in format expected by frontend: { success: true, data: { authUrl } }
      const response = successResponse({ authUrl }, 'OAuth URL generated');
      console.log('[Meta OAuth Initiate] Response shape:', JSON.stringify({ success: response.success, hasAuthUrl: !!response.data?.authUrl }));
      
      res.json(response);
    } catch (error: any) {
      console.error('[Meta OAuth Initiate] Error:', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        stack: error.stack
      });
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

      // Handle OAuth errors from Meta
      if (error) {
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
          return res.status(500).json({
            success: false,
            error: 'FRONTEND_URL not configured'
          });
        }
        const errorMessage = String(error_description || error_reason || 'OAuth authorization failed');
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

      // Validate environment variables (fail-fast)
      const metaAppId = process.env.META_APP_ID;
      const metaAppSecret = process.env.META_APP_SECRET;
      const backendUrl = process.env.BACKEND_URL;

      if (!metaAppId || !metaAppSecret || !backendUrl) {
        throw new AppError(
          500,
          'CONFIGURATION_ERROR',
          'Meta OAuth not configured. Missing required environment variables.'
        );
      }

      // Build redirect URI - must match what was used in initiateOAuth
      const redirectUri = `${backendUrl}/api/v1/social-integrations/${platform}/oauth/callback`;
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId!, // Guaranteed to exist after validation above
        appSecret: metaAppSecret!, // Guaranteed to exist after validation above
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

      // Save integration - OAuth tokens are pre-verified by Meta, skip 360dialog verification
      await socialIntegrationService.upsertIntegration({
        ...integrationData,
        skipVerification: true // OAuth tokens are already verified by Meta
      });

      // Redirect to frontend with success
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        throw new AppError(500, 'CONFIGURATION_ERROR', 'FRONTEND_URL not configured');
      }
      res.redirect(`${frontendUrl}/settings/socials?success=true&platform=${platform}`);
    } catch (error: any) {
      // Redirect to frontend with error - ensure FRONTEND_URL is set
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const errorMessage = error.message || 'OAuth callback failed';
      res.redirect(
        `${frontendUrl}/settings/socials?error=${encodeURIComponent(errorMessage)}&platform=${req.params.platform}`
      );
    }
  }
}

export default new SocialIntegrationController();

