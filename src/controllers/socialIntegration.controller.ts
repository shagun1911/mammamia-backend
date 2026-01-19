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

      // For Messenger (Facebook platform), use standard OAuth (NOT Facebook Login for Business)
      // Only use Business Login (config_id) if explicitly needed for other use cases
      const metaConfigId = process.env.META_CONFIG_ID;
      const useBusinessLogin = false; // Messenger uses standard OAuth, not Business Login

      // Log app configuration for debugging
      console.log('[Meta OAuth Initiate] App Configuration:', {
        appId: metaAppId ? `${metaAppId.substring(0, 4)}...${metaAppId.substring(metaAppId.length - 4)}` : 'MISSING',
        hasAppSecret: !!metaAppSecret,
        backendUrl,
        frontendUrl,
        platform,
        useBusinessLogin: platform === 'facebook' ? useBusinessLogin : 'N/A'
      });

      // Log OAuth type for Facebook platform
      if (platform === 'facebook') {
        if (useBusinessLogin && metaConfigId) {
          const maskedConfigId = metaConfigId.length > 8 
            ? `${metaConfigId.substring(0, 4)}...${metaConfigId.substring(metaConfigId.length - 4)}`
            : '***';
          console.log('[Meta OAuth Initiate] Using Facebook Login for Business with config_id:', maskedConfigId);
        } else {
          console.log('[Meta OAuth Initiate] Using standard Facebook OAuth for Messenger (no config_id)');
        }
      }

      // Build redirect URI - must match Meta App settings exactly
      const redirectUri = `${backendUrl}/api/v1/social-integrations/${platform}/oauth/callback`;
      console.log('[Meta OAuth Initiate] Redirect URI:', redirectUri);
      console.log('[Meta OAuth Initiate] ⚠️  IMPORTANT: This redirect URI must EXACTLY match what you added in Meta App settings!');
      console.log('[Meta OAuth Initiate] Expected in Meta App:', redirectUri);

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
      // For Messenger (Facebook), use standard OAuth without config_id
      // For other platforms or Business Login use cases, pass config_id if needed
      const authUrl = metaOAuth.getAuthorizationUrl(
        platform as 'whatsapp' | 'instagram' | 'facebook', 
        state,
        useBusinessLogin ? metaConfigId : undefined, // Only pass config_id if using Business Login
        useBusinessLogin // Flag to indicate Business Login vs standard OAuth
      );

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
   * Also handles webhook verification requests that Meta may send to this URL
   */
  async oauthCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, state, error, error_reason, error_description, error_code, error_message } = req.query;
      
      // Extract platform from URL params or from URL path
      // Specific routes like /facebook/oauth/callback don't have :platform param
      let platform = req.params.platform;
      if (!platform) {
        // Extract from URL path (e.g., /api/v1/social-integrations/facebook/oauth/callback)
        const pathMatch = req.path.match(/\/(facebook|whatsapp|instagram)\/oauth\/callback/);
        if (pathMatch) {
          platform = pathMatch[1];
        }
      }

      // Check if this is a webhook verification request (Meta sometimes sends this to callback URLs)
      const hubMode = req.query['hub.mode'];
      const hubChallenge = req.query['hub.challenge'];
      const hubVerifyToken = req.query['hub.verify_token'];

      if (hubMode === 'subscribe' && hubChallenge && hubVerifyToken) {
        console.log('\n========== META WEBHOOK VERIFICATION (via OAuth callback) ==========');
        console.log('[Meta Webhook Verification] Platform:', platform);
        console.log('[Meta Webhook Verification] Mode:', hubMode);
        console.log('[Meta Webhook Verification] Challenge:', hubChallenge);
        console.log('[Meta Webhook Verification] Verify Token:', hubVerifyToken);
        
        // Get platform-specific verify token from environment
        let verifyToken: string;
        switch (platform) {
          case 'whatsapp':
            verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'whatsapp_verify_token';
            break;
          case 'messenger':
          case 'facebook':
            verifyToken = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN || 'messenger_verify_token';
            break;
          case 'instagram':
            verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'instagram_verify_M9Qe7KX2R4LpA8';
            break;
          default:
            verifyToken = '';
        }

        if (hubVerifyToken === verifyToken) {
          console.log(`[Meta Webhook Verification] ✅ Verification successful for ${platform}`);
          console.log('==========================================\n');
          return res.status(200).send(hubChallenge);
        } else {
          console.log(`[Meta Webhook Verification] ❌ Verification failed for ${platform}`, {
            received: hubVerifyToken,
            expected: verifyToken
          });
          console.log('==========================================\n');
          return res.sendStatus(403);
        }
      }

      console.log('\n========== META OAUTH CALLBACK ==========');
      console.log('[Meta OAuth Callback] Request method:', req.method);
      console.log('[Meta OAuth Callback] Request path:', req.path);
      console.log('[Meta OAuth Callback] URL params:', JSON.stringify(req.params, null, 2));
      console.log('[Meta OAuth Callback] Platform (from URL):', platform || 'NOT FOUND');
      console.log('[Meta OAuth Callback] Full URL:', req.url);
      console.log('[Meta OAuth Callback] Query params:', JSON.stringify(req.query, null, 2));
      console.log('[Meta OAuth Callback] Has code:', !!code);
      console.log('[Meta OAuth Callback] Has state:', !!state);
      console.log('[Meta OAuth Callback] Has error:', !!error);
      console.log('[Meta OAuth Callback] Has error_code:', !!error_code);
      console.log('[Meta OAuth Callback] Has error_message:', !!error_message);
      console.log('==========================================\n');

      // Handle OAuth errors from Meta (check both error formats)
      // Meta can send either: error/error_description OR error_code/error_message
      if (error || error_code) {
        console.error('[Meta OAuth Callback] OAuth error from Meta:', {
          error,
          error_code,
          error_reason,
          error_description,
          error_message
        });
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
          return res.status(500).json({
            success: false,
            error: 'FRONTEND_URL not configured'
          });
        }
        
        // Use error_message if available (new format), otherwise use error_description (old format)
        const errorMessage = String(
          error_message || 
          error_description || 
          error_reason || 
          error || 
          'OAuth authorization failed'
        );
        
        console.log('[Meta OAuth Callback] Redirecting to frontend with error:', errorMessage);
        return res.redirect(
          `${frontendUrl}/settings/socials?error=${encodeURIComponent(errorMessage)}&platform=${platform}`
        );
      }

      if (!code || !state) {
        console.error('[Meta OAuth Callback] Missing code or state:', {
          hasCode: !!code,
          hasState: !!state,
          query: req.query,
          url: req.url
        });
        
        // Redirect to frontend with error instead of throwing
        const frontendUrl = process.env.FRONTEND_URL;
        if (frontendUrl) {
          return res.redirect(
            `${frontendUrl}/settings/socials?error=${encodeURIComponent('Missing authorization code or state. Please try connecting again.')}&platform=${platform}`
          );
        }
        
        throw new AppError(400, 'INVALID_REQUEST', 'Missing authorization code or state');
      }

      // Decode state
      const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      const { organizationId, platform: statePlatform, redirectUrl } = stateData;

      // Use platform from state as source of truth (it's what was used to initiate OAuth)
      // If platform from URL doesn't match, use state platform and log a warning
      if (platform && platform !== statePlatform) {
        console.warn('[Meta OAuth Callback] Platform mismatch detected:', {
          urlPlatform: platform,
          statePlatform: statePlatform,
          url: req.path
        });
        // Use state platform as it's the source of truth
        platform = statePlatform;
      } else if (!platform && statePlatform) {
        // If platform not in URL, use from state
        platform = statePlatform;
      }

      if (!platform) {
        throw new AppError(400, 'INVALID_REQUEST', 'Platform not found in URL or state');
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

      // Get user information (matching Python reference implementation)
      const userInfo = await metaOAuth.getUserInfo(accessToken);
      const userId = userInfo.id;
      const userName = userInfo.name || 'Unknown';
      const userEmail = userInfo.email || '';

      console.log('[Meta OAuth Callback] User info retrieved:', {
        userId,
        userName,
        hasEmail: !!userEmail
      });

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
        // For Facebook/Messenger, store all pages with their access tokens
        // Each page access token can be used to send messages via Messenger API
        const selectedPage = pages[0]; // Use first page as primary
        integrationData.facebookPageId = selectedPage.id;
        
        // Store all pages with their access tokens (matching Python reference)
        const pagesData = pages.map(page => ({
          page_id: page.id,
          page_name: page.name,
          access_token: page.access_token, // Page Access Token for Messenger API
          category: page.category || ''
        }));
        
        integrationData.credentials = {
          apiKey: accessToken, // User Access Token (long-lived)
          clientId: metaAppId,
          facebookPageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token, // Primary page access token
          pages: pagesData // All pages with access tokens
        };
        
        console.log('[Meta OAuth Callback] Facebook pages stored:', {
          totalPages: pages.length,
          pages: pagesData.map(p => ({ id: p.page_id, name: p.page_name }))
        });

        // Automatically subscribe Page to webhooks for Messenger chatbot
        let webhookSubscribed = false;
        try {
          console.log('[Meta OAuth Callback] Subscribing Page to Messenger webhooks...');
          const subscribed = await metaOAuth.subscribePageToWebhooks(selectedPage.id, selectedPage.access_token);
          if (subscribed) {
            webhookSubscribed = true;
            console.log('[Meta OAuth Callback] ✅ Page subscribed to Messenger webhooks successfully');
          } else {
            console.warn('[Meta OAuth Callback] ⚠️  Page webhook subscription may have failed (might already be subscribed)');
          }
        } catch (error: any) {
          console.error('[Meta OAuth Callback] ⚠️  Failed to subscribe Page to webhooks:', error.message);
          // Don't throw - continue with integration even if webhook subscription fails
        }

        // Mark chatbot as enabled for this integration
        integrationData.metadata = {
          ...integrationData.metadata,
          chatbotEnabled: true,
          connectedAt: new Date().toISOString(),
          userId: userId,
          userName: userName
        };
        
        // Set webhookVerified if subscription succeeded
        integrationData.webhookVerified = webhookSubscribed;
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

      // Log integration data before saving
      console.log('[Meta OAuth Callback] Saving integration with data:', {
        platform: integrationData.platform,
        hasMetadata: !!integrationData.metadata,
        chatbotEnabled: integrationData.metadata?.chatbotEnabled,
        webhookVerified: integrationData.webhookVerified,
        hasCredentials: !!integrationData.credentials
      });

      // Save integration - OAuth tokens are pre-verified by Meta, skip 360dialog verification
      const savedIntegration = await socialIntegrationService.upsertIntegration({
        ...integrationData,
        skipVerification: true // OAuth tokens are already verified by Meta
      });

      console.log('[Meta OAuth Callback] ✅ Integration saved:', {
        id: savedIntegration._id,
        platform: savedIntegration.platform,
        status: savedIntegration.status,
        chatbotEnabled: savedIntegration.metadata?.chatbotEnabled,
        webhookVerified: savedIntegration.webhookVerified
      });

      // Redirect to frontend with success
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        throw new AppError(500, 'CONFIGURATION_ERROR', 'FRONTEND_URL not configured');
      }
      
      console.log('[Meta OAuth Callback] ✅ Success! Redirecting to frontend:', `${frontendUrl}/settings/socials?success=true&platform=${platform}`);
      res.redirect(`${frontendUrl}/settings/socials?success=true&platform=${platform}`);
    } catch (error: any) {
      console.error('\n========== META OAUTH CALLBACK ERROR ==========');
      console.error('[Meta OAuth Callback] Error:', error.message);
      console.error('[Meta OAuth Callback] Error stack:', error.stack);
      console.error('[Meta OAuth Callback] Error code:', error.code);
      console.error('================================================\n');
      
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

