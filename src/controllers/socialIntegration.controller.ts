import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import socialIntegrationService from '../services/socialIntegration.service';
import { AppError } from '../middleware/error.middleware';
import { MetaOAuthService, MetaPage } from '../services/metaOAuth.service';
import { successResponse } from '../utils/response.util';
import mongoose from 'mongoose';
import GoogleIntegration from '../models/GoogleIntegration';
import SocialIntegration from '../models/SocialIntegration';

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
      
      // Also fetch GoogleIntegration to include Gmail email
      const googleIntegration = await GoogleIntegration.findOne({
        organizationId: organizationId
      }).lean();

      // If GoogleIntegration exists with Gmail enabled, add/update Gmail integration with email
      if (googleIntegration && googleIntegration.services?.gmail && googleIntegration.googleProfile?.email) {
        const gmailIntegrationIndex = integrations.findIndex(
          (integration: any) => integration.platform === 'gmail'
        );

        const gmailEmail = googleIntegration.googleProfile.email;
        const gmailStatus = googleIntegration.status === 'active' ? 'connected' : 'disconnected';

        if (gmailIntegrationIndex >= 0) {
          // Merge with existing Gmail integration
          const existingIntegration = integrations[gmailIntegrationIndex] as any;
          (integrations as any)[gmailIntegrationIndex] = {
            ...existingIntegration,
            status: gmailStatus,
            credentials: {
              ...existingIntegration.credentials,
              email: gmailEmail
            },
            metadata: {
              ...existingIntegration.metadata,
              email: gmailEmail,
              name: googleIntegration.googleProfile.name,
              picture: googleIntegration.googleProfile.picture
            }
          };
        } else {
          // Add new Gmail integration entry
          (integrations as any[]).push({
            platform: 'gmail',
            status: gmailStatus,
            credentials: {
              email: gmailEmail,
              apiKey: '***********'
            },
            metadata: {
              email: gmailEmail,
              name: googleIntegration.googleProfile.name,
              picture: googleIntegration.googleProfile.picture
            }
          });
        }
      }
      
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

      if (!['whatsapp', 'instagram', 'facebook', 'gmail'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      const integration = await socialIntegrationService.getIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook' | 'gmail'
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

      // Include current webhook config so UI always shows the token backend will accept
      const backendUrl = process.env.BACKEND_URL || '';
      if (platform === 'instagram') {
        const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'instagram_verify_M9Qe7KX2R4LpA8';
        (response as any).webhookConfiguration = {
          url: backendUrl ? `${backendUrl}/api/v1/webhooks/instagram` : '',
          verifyToken
        };
      }
      if (platform === 'facebook') {
        const verifyToken = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN || 'messenger_verify_token';
        (response as any).webhookConfiguration = {
          url: backendUrl ? `${backendUrl}/api/v1/social-integrations/messenger/webhook` : '',
          verifyToken
        };
      }

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
      // CRITICAL: Get userId from authenticated user (REQUIRED for data isolation)
      const userId = (req as any).user?._id?.toString();
      const organizationId = (req as any).user?.organizationId || (req as any).user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User ID not found. User must be authenticated.');
      }
      
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      console.log('[Social Integration Connect] Creating integration with userId:', userId, 'organizationId:', organizationId);
      
      const { platform } = req.params;
      const {
        apiKey,
        clientId,
        phoneNumberId,
        wabaId,
        instagramAccountId,
        facebookPageId
      } = req.body;

      if (!['whatsapp', 'instagram', 'facebook', 'gmail'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      // Gmail uses OAuth, not API keys - skip API key validation
      if (platform !== 'gmail' && !apiKey) {
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
        userId, // REQUIRED: User who owns this integration
        organizationId,
        platform: platform as 'whatsapp' | 'instagram' | 'facebook' | 'gmail',
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

      if (!['whatsapp', 'instagram', 'facebook', 'gmail'].includes(platform)) {
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

      if (!['whatsapp', 'instagram', 'facebook', 'gmail'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      await socialIntegrationService.disconnectIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook' | 'gmail'
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

      if (!['whatsapp', 'instagram', 'facebook', 'gmail'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', 'Invalid platform');
      }

      await socialIntegrationService.deleteIntegration(
        organizationId,
        platform as 'whatsapp' | 'instagram' | 'facebook' | 'gmail'
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

      // Handle Gmail OAuth separately (uses Python API, not Meta OAuth)
      if (platform === 'gmail') {
        console.log('[Gmail OAuth Initiate] Request:', {
          platform,
          userId: req.user._id?.toString(),
          organizationId: organizationId?.toString(),
          hasUser: !!req.user
        });
        const gmailOAuthService = (await import('../services/gmailOAuth.service')).default;
        return gmailOAuthService.authorize(req, res);
      }

      console.log('[Meta OAuth Initiate] Request:', {
        platform,
        userId: req.user._id?.toString(),
        organizationId: organizationId?.toString(),
        hasUser: !!req.user
      });

      // Validate platform for Meta OAuth
      if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
        throw new AppError(400, 'INVALID_PLATFORM', `Invalid platform: ${platform}. Must be one of: whatsapp, instagram, facebook, gmail`);
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
      console.log('\n========== META OAUTH CALLBACK (PUBLIC ROUTE) ==========');
      console.log('[Meta OAuth Callback] Method:', req.method);
      console.log('[Meta OAuth Callback] URL:', req.url);
      console.log('[Meta OAuth Callback] Path:', req.path);
      console.log('[Meta OAuth Callback] Query:', req.query);
      console.log('[Meta OAuth Callback] Body:', req.body);
      
      // OAuth callbacks can be GET (query params) or POST (body params)
      // Meta typically uses GET, but some flows may use POST
      const queryParams = req.query || {};
      const bodyParams = req.body || {};
      
      // Merge query and body params (query takes precedence)
      const { 
        code, 
        state, 
        error, 
        error_reason, 
        error_description, 
        error_code, 
        error_message 
      } = { ...bodyParams, ...queryParams };
      
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

      // Check if this is actually a webhook event (Meta sometimes sends webhooks to callback URLs)
      // Reject webhook events - they should go to dedicated webhook endpoints
      if (bodyParams.object === 'page' && Array.isArray(bodyParams.entry)) {
        console.log('[Meta OAuth Callback] ⚠️  Messenger webhook event received at OAuth callback route');
        console.log('[Meta OAuth Callback] Webhook events should be sent to /api/v1/social-integrations/messenger/webhook');
        console.log('[Meta OAuth Callback] Returning 200 to acknowledge but not processing');
        return res.sendStatus(200); // Acknowledge but don't process
      }

      // Reject Instagram webhook events
      if (bodyParams.object === 'instagram' && Array.isArray(bodyParams.entry)) {
        console.log('[Meta OAuth Callback] ⚠️  Instagram webhook event received at OAuth callback route');
        console.log('[Meta OAuth Callback] Instagram webhook events should be sent to /api/v1/webhooks/instagram');
        console.log('[Meta OAuth Callback] Returning 200 to acknowledge but not processing');
        return res.sendStatus(200); // Acknowledge but don't process
      }

      // Check if this is a webhook verification request (Meta sometimes sends this to callback URLs)
      // Handle both GET (query) and POST (body) for webhook verification
      const hubMode = queryParams['hub.mode'] || bodyParams['hub.mode'] || queryParams['hub_mode'] || bodyParams['hub_mode'];
      const hubChallenge = queryParams['hub.challenge'] || bodyParams['hub.challenge'] || queryParams['hub_challenge'] || bodyParams['hub_challenge'];
      const hubVerifyToken = queryParams['hub.verify_token'] || bodyParams['hub.verify_token'] || queryParams['hub_verify_token'] || bodyParams['hub_verify_token'];

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
      const { userId: appUserId, organizationId, platform: statePlatform, redirectUrl } = stateData;

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

      // Platform-specific handling
      // CRITICAL: Use appUserId from state as userId (this is the authenticated user who initiated OAuth)
      const userId = appUserId; // appUserId from OAuth state is the authenticated user
      
      if (!userId) {
        throw new AppError(400, 'MISSING_USER_ID', 'User ID not found in OAuth state. Cannot create integration without userId.');
      }

      console.log('[Meta OAuth Callback] Using userId from OAuth state:', userId, 'organizationId:', organizationId);

      let integrationData: any = {
        userId, // REQUIRED: User who owns this integration
        organizationId,
        platform: platform as 'whatsapp' | 'instagram' | 'facebook' | 'gmail',
        clientId: metaAppId
      };

      // Exchange code for short-lived token (standard Facebook OAuth for all platforms)
      const tokenResponse = await metaOAuth.exchangeCodeForToken(code as string);
      const shortLivedToken = tokenResponse.access_token;

      // Exchange for long-lived token (60 days)
      const longLivedTokenResponse = await metaOAuth.getLongLivedToken(shortLivedToken);
      const accessToken = longLivedTokenResponse.access_token;

      // Get user information (matching Python reference implementation)
      const userInfo = await metaOAuth.getUserInfo(accessToken);
      const metaUserId = userInfo.id; // Meta Facebook user ID (for reference only)
      const userName = userInfo.name || 'Unknown';
      const userEmail = userInfo.email || '';

      console.log('[Meta OAuth Callback] User info retrieved:', {
        metaUserId,
        userName,
        hasEmail: !!userEmail
      });

      integrationData.apiKey = accessToken; // Store access token as apiKey for compatibility

      if (platform === 'instagram') {
        // Instagram OAuth: Use Facebook OAuth, then fetch pages and Instagram Business Account
        console.log('[Instagram Business Login] Starting Instagram OAuth flow via Facebook...');
        
        // Step 1: Get all pages using USER access token
        const pages = await metaOAuth.getUserPages(accessToken);

        if (pages.length === 0) {
          throw new AppError(400, 'NO_PAGES', 'No Facebook Pages found. Please create a Facebook Page first.');
        }

        console.log(`[Instagram Business Login] Found ${pages.length} Facebook Page(s)`);

        // Step 2: For each page, check if it has an Instagram Business Account
        let instagramAccountId: string | null = null;
        let selectedPage: MetaPage | null = null;
        let pageAccessToken: string | null = null;

        for (const page of pages) {
          console.log(`[Instagram Business Login] Checking page ${page.id} for Instagram account...`);
          console.log(`[Instagram Business Login] Page access token prefix: ${page.access_token.substring(0, 10)}...`);
          
          // Validate that this is a PAGE token (EAAG), not a USER token
          if (!page.access_token.startsWith('EAAG') && !page.access_token.startsWith('EAA')) {
            console.warn(`[Instagram Business Login] Page ${page.id} access token does not start with EAAG/EAA, skipping`);
            continue;
          }

          // Step 3: Get Instagram Business Account for this page
          const instagramAccounts = await metaOAuth.getInstagramAccounts(page.id, page.access_token);
          
          if (instagramAccounts.length > 0) {
            instagramAccountId = instagramAccounts[0].id;
            selectedPage = page;
            pageAccessToken = page.access_token;
            console.log(`[Instagram Business Login] ✅ Found Instagram account ${instagramAccountId} on page ${page.id}`);
            console.log(`[Instagram Business Login] ✅ Page access token (EAAG): ${pageAccessToken.substring(0, 10)}...`);
            break;
          }
        }

        if (!instagramAccountId || !selectedPage || !pageAccessToken) {
          throw new AppError(
            400,
            'NO_INSTAGRAM_ACCOUNT',
            'No Instagram Business Account found. Please connect an Instagram account to your Facebook Page.'
          );
        }

        // Step 4: Validate page access token is EAAG
        if (!pageAccessToken.startsWith('EAAG') && !pageAccessToken.startsWith('EAA')) {
          throw new AppError(
            400,
            'INVALID_PAGE_TOKEN',
            'Instagram Page Access Token not resolved — cannot send DMs'
          );
        }

        console.log('[Instagram Business Login] Step 4: Storing credentials with PAGE access token');
        console.log('[Instagram Business Login] - instagramAccountId:', instagramAccountId);
        console.log('[Instagram Business Login] - facebookPageId:', selectedPage.id);
        console.log('[Instagram Business Login] - pageAccessToken prefix:', pageAccessToken.substring(0, 10) + '...');
        console.log('[Instagram Business Login] - apiKey (user token):', accessToken.substring(0, 10) + '...');

        // Store Instagram-specific credentials with Page Access Token
        integrationData.instagramAccountId = instagramAccountId;
        integrationData.facebookPageId = selectedPage.id;
        integrationData.credentials = {
          apiKey: accessToken, // Store user token for reference
          clientId: metaAppId,
          instagramAccountId,
          facebookPageId: selectedPage.id,
          pageAccessToken: pageAccessToken // Store PAGE token for sending DMs (EAAG)
        };

        // Step 5: Automatically subscribe Page to webhooks for Instagram messaging
        // The Facebook Page linked to the Instagram account must be subscribed to receive events
        let webhookSubscribed = false;
        try {
          console.log(`[Instagram Business Login] Subscribing Page ${selectedPage.id} to webhooks...`);
          const subscribed = await metaOAuth.subscribePageToWebhooks(selectedPage.id, pageAccessToken);
          if (subscribed) {
            webhookSubscribed = true;
            console.log('[Instagram Business Login] ✅ Page subscribed to webhooks successfully');
          } else {
            console.warn('[Instagram Business Login] ⚠️  Page webhook subscription may have failed (might already be subscribed)');
          }
        } catch (error: any) {
          console.error('[Instagram Business Login] ⚠️  Failed to subscribe Page to webhooks:', error.message);
          // Don't throw - continue even if webhook subscription fails as it might already be active
        }

        console.log('[Instagram Business Login] ✅ Instagram OAuth completed successfully');
      } else if (platform === 'whatsapp') {
        // WhatsApp OAuth: Use ONLY WhatsApp Business endpoints (NO Page endpoints)
        // Flow: User → Businesses → WABAs → Phone Numbers
        console.log('[WhatsApp OAuth] Starting WhatsApp Business Account discovery...');

        // Step 1: Get businesses user belongs to
        const businesses = await metaOAuth.getUserBusinesses(accessToken);
        console.log('[WhatsApp OAuth] Businesses found:', businesses.length);

        if (businesses.length === 0) {
          throw new AppError(
            400,
            'NO_WHATSAPP_ACCOUNT',
            'No WhatsApp Business Account accessible via API. Ensure the WhatsApp account is owned by a Meta Business and the user has admin access.'
          );
        }

        // Step 2: Get owned WhatsApp Business Accounts for each business
        let wabaId: string | null = null;
        let wabaName: string | null = null;

        for (const business of businesses) {
          const wabas = await metaOAuth.getOwnedWhatsAppBusinessAccounts(business.id, accessToken);
          console.log(`[WhatsApp OAuth] Business ${business.name} (${business.id}) - WABAs found:`, wabas.length);

          if (wabas.length > 0) {
            // Use first WABA found
            wabaId = wabas[0].id;
            wabaName = wabas[0].name;
            console.log('[WhatsApp OAuth] Using WABA:', { id: wabaId, name: wabaName });
            break;
          }
        }

        if (!wabaId) {
          console.log('[WhatsApp OAuth] No WABAs found in any business');
          throw new AppError(
            400,
            'NO_WHATSAPP_ACCOUNT',
            'No WhatsApp Business Account accessible via API. Ensure the WhatsApp account is owned by a Meta Business and the user has admin access.'
          );
        }

        // Step 3: Get phone numbers for the WABA
        const phoneNumberId = await metaOAuth.getWhatsAppPhoneNumberId(wabaId, accessToken);
        console.log('[WhatsApp OAuth] Phone numbers found:', phoneNumberId ? 1 : 0);

        if (!phoneNumberId) {
          console.warn('[WhatsApp OAuth] WABA found but no phone numbers available');
          // Continue anyway - phone number might be added later
        }

        // Store WhatsApp-specific data (NO Page data)
        integrationData.wabaId = wabaId;
        integrationData.phoneNumberId = phoneNumberId;
        integrationData.credentials = {
          apiKey: accessToken, // User Access Token (long-lived)
          clientId: metaAppId,
          phoneNumberId: phoneNumberId || undefined,
          wabaId: wabaId
          // DO NOT store facebookPageId or pageAccessToken for WhatsApp
        };

        integrationData.metadata = {
          ...integrationData.metadata,
          userId: userId,
          userName: userName,
          connectedAt: new Date().toISOString()
        };

        console.log('[WhatsApp OAuth] ✅ WhatsApp integration data prepared:', {
          wabaId,
          wabaName,
          hasPhoneNumberId: !!phoneNumberId,
          credentialsKeys: Object.keys(integrationData.credentials)
        });
      } else if (platform === 'facebook') {
        // For Facebook/Messenger, get pages (requires pages_read_engagement)
        const pages = await metaOAuth.getUserPages(accessToken);

        if (pages.length === 0) {
          throw new AppError(400, 'NO_PAGES', 'No Facebook Pages found. Please create a Facebook Page first.');
        }
        // For Facebook/Messenger, store primary page access token
        // Webhook will use credentials.pageAccessToken and credentials.facebookPageId
        const selectedPage = pages[0]; // Use first page as primary
        integrationData.facebookPageId = selectedPage.id;
        
        // Store only primary page access token (matching schema structure)
        // CRITICAL: pageAccessToken must be persisted for Messenger webhook to work
        integrationData.credentials = {
          apiKey: accessToken, // User Access Token (long-lived)
          clientId: metaAppId,
          facebookPageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token // Page Access Token for Messenger API - MUST BE PERSISTED
        };
        
        console.log('[Meta OAuth Callback] Facebook page credentials prepared:', {
          pageId: selectedPage.id,
          pageName: selectedPage.name,
          hasAccessToken: !!selectedPage.access_token,
          accessTokenLength: selectedPage.access_token?.length || 0,
          credentialsKeys: Object.keys(integrationData.credentials),
          hasPageAccessToken: !!integrationData.credentials.pageAccessToken
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
        // Store INTERNAL app userId (from OAuth state) for KnowledgeBase lookup
        // DO NOT store Meta Facebook userId - use appUserId from state
        integrationData.metadata = {
          ...integrationData.metadata,
          chatbotEnabled: true,
          connectedAt: new Date().toISOString(),
          appUserId: appUserId, // Internal app userId for KB lookup
          metaUserId: metaUserId, // Meta Facebook userId (for reference only)
          userName: userName
        };
        
        // Set webhookVerified if subscription succeeded
        integrationData.webhookVerified = webhookSubscribed;
      }

      // Log integration data before saving
      console.log('[Meta OAuth Callback] Saving integration with data:', {
        platform: integrationData.platform,
        hasMetadata: !!integrationData.metadata,
        chatbotEnabled: integrationData.metadata?.chatbotEnabled,
        webhookVerified: integrationData.webhookVerified,
        hasCredentials: !!integrationData.credentials,
        credentialsKeys: integrationData.credentials ? Object.keys(integrationData.credentials) : [],
        hasPageAccessToken: !!integrationData.credentials?.pageAccessToken,
        hasFacebookPageId: !!integrationData.credentials?.facebookPageId
      });

      // Save integration - OAuth tokens are pre-verified by Meta, skip 360dialog verification
      const savedIntegration = await socialIntegrationService.upsertIntegration({
        ...integrationData,
        skipVerification: true // OAuth tokens are already verified by Meta
      });

      // Verify pageAccessToken was persisted
      const savedCredentials = (savedIntegration.credentials as any);
      console.log('[Meta OAuth Callback] ✅ Integration saved:', {
        id: savedIntegration._id,
        platform: savedIntegration.platform,
        status: savedIntegration.status,
        chatbotEnabled: savedIntegration.metadata?.chatbotEnabled,
        webhookVerified: savedIntegration.webhookVerified,
        hasPageAccessToken: !!savedCredentials?.pageAccessToken,
        hasFacebookPageId: !!savedCredentials?.facebookPageId,
        pageAccessTokenLength: savedCredentials?.pageAccessToken?.length || 0
      });
      
      if (!savedCredentials?.pageAccessToken) {
        console.error('[Meta OAuth Callback] ❌ CRITICAL: pageAccessToken was NOT persisted!');
        console.error('[Meta OAuth Callback] Saved credentials:', {
          keys: Object.keys(savedCredentials || {}),
          hasApiKey: !!savedCredentials?.apiKey,
          hasFacebookPageId: !!savedCredentials?.facebookPageId
        });
      }

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

  /**
   * Connect WhatsApp manually using Access Token, Phone Number ID, and WABA ID
   * POST /api/v1/social-integrations/whatsapp/connect-manual
   */
  async connectWhatsAppManual(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User ID not found');
      }
      
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const { accessToken, phoneNumberId, wabaId } = req.body;

      // Validate required fields
      if (!accessToken || !phoneNumberId || !wabaId) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'accessToken, phoneNumberId, and wabaId are all required'
        );
      }

      console.log('[WhatsApp Manual Connect] Connecting with credentials:', {
        userId,
        organizationId: organizationId.toString(),
        phoneNumberId,
        wabaId: wabaId.substring(0, 10) + '...'
      });

      // Verify credentials by testing API call to Meta
      try {
        const axios = (await import('axios')).default;
        const testUrl = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`;
        
        await axios.get(testUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        console.log('[WhatsApp Manual Connect] ✅ Credentials verified with Meta API');
      } catch (verifyError: any) {
        console.error('[WhatsApp Manual Connect] ❌ Credential verification failed:', verifyError.response?.data || verifyError.message);
        throw new AppError(
          400,
          'INVALID_CREDENTIALS',
          'Invalid WhatsApp credentials. Please check your Access Token and WABA ID.'
        );
      }

      // Create integration directly without 360dialog verification
      // This matches the automation's manual WhatsApp flow
      const integrationData = {
        userId,
        organizationId,
        platform: 'whatsapp' as const,
        apiKey: accessToken,
        phoneNumberId,
        wabaId,
        credentials: {
          apiKey: accessToken,
          phoneNumberId,
          wabaId
        },
        metadata: {
          connectedAt: new Date().toISOString(),
          connectionType: 'manual'
        },
        skipVerification: true // IMPORTANT: Skip 360dialog verification, use Meta API directly
      };

      const integration = await socialIntegrationService.upsertIntegration(integrationData);

      console.log('[WhatsApp Manual Connect] ✅ Integration saved:', integration._id);

      // Attempt to subscribe webhook programmatically
      let webhookSubscribed = false;
      try {
        const axios = (await import('axios')).default;
        const appId = process.env.META_APP_ID;
        
        // Subscribe WABA to receive messages via webhook
        const subscribeResponse = await axios.post(
          `https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`,
          {
            subscribed_fields: ['messages', 'message_status']
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (subscribeResponse.data.success === true) {
          webhookSubscribed = true;
          console.log('[WhatsApp Manual Connect] ✅ Webhook subscribed successfully via API');
          
          // Update integration with webhook status
          integration.webhookVerified = true;
          await integration.save();
        } else {
          console.warn('[WhatsApp Manual Connect] ⚠️  Webhook subscription returned success: false');
        }
      } catch (webhookError: any) {
        // Webhook subscription might fail if:
        // 1. Webhook URL not configured in Meta App Dashboard
        // 2. User doesn't have permission
        // 3. Webhook already subscribed
        console.warn('[WhatsApp Manual Connect] ⚠️  Webhook subscription via API failed:', {
          error: webhookError.response?.data || webhookError.message,
          note: 'User may need to configure webhook URL manually in Meta App Dashboard'
        });
        // Don't fail the connection - user can configure webhook manually
      }

      // Prepare webhook configuration info for user
      const baseUrl = process.env.NGROK_BASE_URL || process.env.BACKEND_URL || 'https://your-domain.com';
      const webhookUrl = `${baseUrl}/api/v1/social-integrations/whatsapp/webhook`;
      const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'whatsapp_verify_token';

      res.json(successResponse(
        {
          ...integration.toObject(),
          credentials: {
            ...integration.credentials,
            apiKey: '***********' // Mask in response
          },
          // Add webhook configuration info
          webhookConfiguration: {
            url: webhookUrl,
            verifyToken: verifyToken,
            subscribed: webhookSubscribed,
            instructions: webhookSubscribed 
              ? 'Webhook automatically subscribed! You can still verify it in Meta App Dashboard if needed.'
              : 'Please configure this webhook in your Meta App Dashboard → WhatsApp → Configuration → Webhooks'
          }
        },
        webhookSubscribed 
          ? 'WhatsApp connected successfully. Webhook automatically subscribed!'
          : 'WhatsApp connected successfully. Please configure the webhook in your Meta App Dashboard.'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Connect Instagram manually using Access Token, Instagram Account ID, and Page ID
   * POST /api/v1/social-integrations/instagram/connect-manual
   */
  async connectInstagramManual(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User ID not found');
      }
      
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const { accessToken, instagramAccountId, facebookPageId } = req.body;

      // Validate required fields
      if (!accessToken || !instagramAccountId || !facebookPageId) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'accessToken, instagramAccountId, and facebookPageId are all required'
        );
      }

      console.log('[Instagram Manual Connect] Connecting with credentials:', {
        userId,
        organizationId: organizationId.toString(),
        instagramAccountId,
        facebookPageId
      });

      // Prevent same Instagram account being connected by multiple orgs (only one org can receive replies)
      const pageIdStr = String(instagramAccountId);
      const orgObjectId = new mongoose.Types.ObjectId(organizationId.toString());
      const existingOther = await SocialIntegration.findOne({
        'credentials.instagramAccountId': { $in: [pageIdStr, Number(pageIdStr)] },
        platform: 'instagram',
        status: 'connected',
        organizationId: { $ne: orgObjectId }
      });
      if (existingOther) {
        throw new AppError(
          400,
          'PAGE_ALREADY_CONNECTED',
          'This Instagram account is already connected to another organization. Each Instagram account can only be connected to one organization so that replies work correctly. Disconnect it from the other organization first, or use a different account.'
        );
      }

      // Verify credentials by testing API call to Meta (skip and proceed if app lacks permissions)
      const axios = (await import('axios')).default;
      let verificationSkippedDueToPermission = false;
      try {
        const testUrl = `https://graph.facebook.com/v19.0/${instagramAccountId}`;
        await axios.get(testUrl, {
          params: {
            fields: 'id,username,name',
            access_token: accessToken
          },
          timeout: 10000
        });
        console.log('[Instagram Manual Connect] ✅ Credentials verified with Meta API');
      } catch (verifyError: any) {
        const metaError = verifyError.response?.data?.error;
        const code = metaError?.code;
        const subcode = metaError?.error_subcode;
        const message = String(metaError?.message || verifyError.message || '').toLowerCase();

        // Error 100 / subcode 33 or "does not exist" / "missing permissions" = Meta blocked read; token may still work for messaging
        const permissionOrObjectError =
          code === 100 &&
          (subcode === 33 || message.includes('does not exist') || message.includes('missing permission'));

        if (permissionOrObjectError) {
          verificationSkippedDueToPermission = true;
          console.warn(
            '[Instagram Manual Connect] ⚠️ Verification skipped (missing permissions). Proceeding to save; token may still work for messaging.'
          );
        } else {
          console.error('[Instagram Manual Connect] ❌ Credential verification failed:', verifyError.response?.data || verifyError.message);
          throw new AppError(
            400,
            'INVALID_CREDENTIALS',
            metaError?.message || 'Invalid Instagram credentials. Please check your Access Token and Instagram Account ID.'
          );
        }
      }

      // Create integration directly without 360dialog verification
      const integrationData = {
        userId,
        organizationId,
        platform: 'instagram' as const,
        apiKey: accessToken,
        instagramAccountId: String(instagramAccountId),
        facebookPageId: String(facebookPageId),
        credentials: {
          apiKey: accessToken,
          instagramAccountId: String(instagramAccountId),
          facebookPageId: String(facebookPageId),
          pageAccessToken: accessToken
        },
        metadata: {
          connectedAt: new Date().toISOString(),
          connectionType: 'manual',
          chatbotEnabled: true
        },
        webhookVerified: false, // Will be true after user configures webhook in Meta Dashboard
        skipVerification: true // Skip 360dialog verification, use Meta API directly
      };

      const integration = await socialIntegrationService.upsertIntegration(integrationData);

      console.log('[Instagram Manual Connect] ✅ Integration saved:', integration._id);

      // Attempt to subscribe webhook programmatically (similar to Facebook)
      let webhookSubscribed = false;
      try {
        const axios = (await import('axios')).default;
        
        // Subscribe Instagram account to webhooks via the connected Facebook Page
        // Instagram webhooks are subscribed via the Page, not directly
        const subscribeUrl = `https://graph.facebook.com/v19.0/${facebookPageId}/subscribed_apps`;
        await axios.post(
          subscribeUrl,
          {
            subscribed_fields: ['messages', 'messaging_postbacks', 'message_reactions']
          },
          {
            params: {
              access_token: accessToken
            }
          }
        );
        
        webhookSubscribed = true;
        console.log('[Instagram Manual Connect] ✅ Webhook automatically subscribed');
        
        // Update webhookVerified status
        integration.webhookVerified = true;
        await integration.save();
      } catch (webhookError: any) {
        console.warn('[Instagram Manual Connect] ⚠️ Failed to auto-subscribe webhook:', webhookError.response?.data || webhookError.message);
      }

      // Get webhook configuration
      const backendUrl = process.env.BACKEND_URL;
      const webhookUrl = `${backendUrl}/api/v1/webhooks/instagram`;
      const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'instagram_verify_M9Qe7KX2R4LpA8';

      const successMsg =
        webhookSubscribed
          ? 'Instagram connected successfully. Webhook automatically subscribed!'
          : 'Instagram connected successfully. Please configure the webhook in your Meta App Dashboard.';
      const finalMessage = verificationSkippedDueToPermission
        ? successMsg + ' (Verification was skipped due to app permissions; messaging may still work.)'
        : successMsg;

      res.json(successResponse(
        {
          ...integration.toObject(),
          credentials: {
            ...integration.credentials,
            apiKey: '***********' // Mask in response
          },
          webhookConfiguration: {
            url: webhookUrl,
            verifyToken: verifyToken,
            subscribed: webhookSubscribed
          },
          ...(verificationSkippedDueToPermission && { warning: 'Verification skipped: app may need additional Meta permissions for full features.' })
        },
        finalMessage
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Connect Facebook manually using Page Access Token and Page ID
   * POST /api/v1/social-integrations/facebook/connect-manual
   */
  async connectFacebookManual(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id?.toString();
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User ID not found');
      }
      
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const { pageAccessToken, facebookPageId, appId } = req.body;

      // Validate required fields
      if (!pageAccessToken || !facebookPageId) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'pageAccessToken and facebookPageId are required'
        );
      }

      // No prefix check: any token is allowed; validity is determined by the Meta API verification below.
      console.log('[Facebook Manual Connect] Connecting with credentials:', {
        userId,
        organizationId: organizationId.toString(),
        facebookPageId,
        hasAppId: !!appId
      });

      // Prevent same Facebook Page being connected by multiple orgs (only one org can receive replies)
      const pageIdStr = String(facebookPageId);
      const orgObjectId = new mongoose.Types.ObjectId(organizationId.toString());
      const existingOther = await SocialIntegration.findOne({
        'credentials.facebookPageId': { $in: [pageIdStr, Number(pageIdStr)] },
        platform: 'facebook',
        status: 'connected',
        organizationId: { $ne: orgObjectId }
      });
      if (existingOther) {
        throw new AppError(
          400,
          'PAGE_ALREADY_CONNECTED',
          'This Facebook Page is already connected to another organization. Each Page can only be connected to one organization so that replies work correctly. Disconnect it from the other organization first, or use a different Page.'
        );
      }

      // Verify credentials by testing API call to Meta (when app has pages_read_engagement / Page access)
      const axios = (await import('axios')).default;
      let verificationSkippedDueToPermission = false;
      try {
        const testUrl = `https://graph.facebook.com/v19.0/${facebookPageId}`;
        await axios.get(testUrl, {
          params: {
            fields: 'id,name',
            access_token: pageAccessToken
          },
          timeout: 10000
        });
        console.log('[Facebook Manual Connect] ✅ Credentials verified with Meta API');
      } catch (verifyError: any) {
        const metaError = verifyError.response?.data?.error;
        const code = metaError?.code;
        const message = metaError?.message || verifyError.message || '';

        // Error 100 = missing permission (e.g. pages_read_engagement) or object not accessible. Token may still work for messaging.
        if (code === 100 && (message.includes('permission') || message.includes('Page Public') || message.includes('does not exist'))) {
          verificationSkippedDueToPermission = true;
          console.warn('[Facebook Manual Connect] ⚠️ Page read verification skipped (app missing pages_read_engagement or similar). Proceeding to save; token may still work for messaging.');
        } else {
          console.error('[Facebook Manual Connect] ❌ Credential verification failed:', verifyError.response?.data || verifyError.message);
          throw new AppError(
            400,
            'INVALID_CREDENTIALS',
            metaError?.message || 'Invalid Facebook credentials. Please check your Page Access Token and Page ID.'
          );
        }
      }

      // Create integration directly without 360dialog verification
      const integrationData = {
        userId,
        organizationId,
        platform: 'facebook' as const,
        apiKey: pageAccessToken,
        facebookPageId: String(facebookPageId),
        clientId: appId || process.env.META_APP_ID,
        credentials: {
          apiKey: pageAccessToken,
          facebookPageId: String(facebookPageId),
          pageAccessToken,
          clientId: appId || process.env.META_APP_ID
        },
        metadata: {
          connectedAt: new Date().toISOString(),
          connectionType: 'manual',
          chatbotEnabled: true
        },
        webhookVerified: false, // Will be updated after webhook subscription attempt
        skipVerification: true // Skip 360dialog verification, use Meta API directly
      };

      const integration = await socialIntegrationService.upsertIntegration(integrationData);

      console.log('[Facebook Manual Connect] ✅ Integration saved:', integration._id);

      // Attempt to subscribe webhook programmatically
      let webhookSubscribed = false;
      try {
        const axios = (await import('axios')).default;
        
        // Subscribe Page to webhooks
        const subscribeUrl = `https://graph.facebook.com/v19.0/${facebookPageId}/subscribed_apps`;
        await axios.post(
          subscribeUrl,
          {
            subscribed_fields: ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries']
          },
          {
            params: {
              access_token: pageAccessToken
            }
          }
        );
        
        webhookSubscribed = true;
        console.log('[Facebook Manual Connect] ✅ Webhook automatically subscribed');
        
        // Update webhookVerified status
        integration.webhookVerified = true;
        await integration.save();
      } catch (webhookError: any) {
        console.warn('[Facebook Manual Connect] ⚠️ Failed to auto-subscribe webhook:', webhookError.response?.data || webhookError.message);
      }

      // Get webhook configuration
      const backendUrl = process.env.BACKEND_URL;
      const webhookUrl = `${backendUrl}/api/v1/social-integrations/messenger/webhook`;
      const verifyToken = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN || 'messenger_verify_token';

      const successMessage = webhookSubscribed
        ? 'Facebook connected successfully. Webhook automatically subscribed!'
        : 'Facebook connected successfully. Please configure the webhook in your Meta App Dashboard.';
      const messageWithWarning = verificationSkippedDueToPermission
        ? successMessage + ' (Page read permission was not verified; if messaging fails, add pages_read_engagement or Page Public Metadata Access to your Meta app.)'
        : successMessage;

      res.json(successResponse(
        {
          ...integration.toObject(),
          credentials: {
            ...integration.credentials,
            apiKey: '***********' // Mask in response
          },
          webhookConfiguration: {
            url: webhookUrl,
            verifyToken: verifyToken,
            subscribed: webhookSubscribed
          },
          ...(verificationSkippedDueToPermission && { warning: 'Verification skipped: app may need pages_read_engagement or Page Public Metadata Access for full features.' })
        },
        messageWithWarning
      ));
    } catch (error) {
      next(error);
    }
  }
}

export default new SocialIntegrationController();

