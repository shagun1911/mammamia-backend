import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface MetaAccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
}

export interface MetaInstagramAccount {
  id: string;
  username: string;
  name?: string;
}

export class MetaOAuthService {
  private appId: string;
  private appSecret: string;
  private redirectUri: string;
  private baseUrl = 'https://graph.facebook.com/v21.0';

  constructor(config: MetaOAuthConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.redirectUri = config.redirectUri;
  }

  /**
   * Generate OAuth authorization URL
   * @param platform - Platform type (whatsapp, instagram, facebook)
   * @param state - OAuth state parameter
   * @param configId - Optional Business Login configuration ID (only for Facebook Login for Business, NOT for Messenger)
   * @param useBusinessLogin - Whether to use Facebook Login for Business (with config_id) or standard OAuth
   */
  getAuthorizationUrl(
    platform: 'whatsapp' | 'instagram' | 'facebook',
    state: string,
    configId?: string,
    useBusinessLogin: boolean = false
  ): string {
    console.log('[Meta OAuth Initiate] Platform:', platform);

    const isBusinessLogin = useBusinessLogin && platform === 'facebook' && !!configId;

    let params: URLSearchParams;

    if (isBusinessLogin) {
      // Facebook Business Login: NO scope — scopes are defined inside the config_id on Meta portal
      // Must include override_default_response_type=true and auth_type=rerequest
      console.log('[Meta OAuth Initiate] Using Facebook Business Login (config_id), scope omitted');
      params = new URLSearchParams({
        client_id: this.appId,
        redirect_uri: this.redirectUri,
        config_id: configId!,
        response_type: 'code',
        override_default_response_type: 'true',
        auth_type: 'rerequest',
        state
      });
    } else {
      // Standard OAuth: include explicit scopes
      const scopes = this.getScopesForPlatform(platform);
      const scopeString = scopes.join(',');
      console.log('[Meta OAuth Initiate] Using standard OAuth, scopes:', scopeString);
      if (platform === 'instagram') {
        console.log('[Instagram Business Login] Using Facebook OAuth dialog');
      }
      params = new URLSearchParams({
        client_id: this.appId,
        redirect_uri: this.redirectUri,
        state,
        scope: scopeString,
        response_type: 'code'
      });
    }

    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Platform-specific OAuth scopes
   * Single source of truth for all Meta OAuth scopes
   * 
   * IMPORTANT:
   * - WhatsApp uses ONLY WhatsApp Business scopes (no Page/Messenger scopes)
   * - Messenger uses ONLY Page/Messenger scopes (no WhatsApp scopes)
   * - No scope bleeding between platforms
   */
  private static readonly META_OAUTH_SCOPES = {
    facebook: [
      'pages_show_list', // List user's pages
      'pages_messaging', // Send and receive messages via Messenger
      'pages_manage_metadata' // Get Page information
    ],
    whatsapp: [
      'whatsapp_business_management', // WhatsApp Business API management
      'whatsapp_business_messaging' // WhatsApp messaging
    ],
    // Instagram messaging uses standard Facebook Page permissions
    // NOTE: instagram_business_manage_messages is NOT an OAuth scope
    // It's an API permission that works with Page Access Token (EAAG)
    // The Instagram Messaging capability comes from:
    // 1. Having Instagram Messaging product in Meta app
    // 2. App review approval for instagram_business_manage_messages
    // 3. Using Page Access Token (EAAG) from /me/accounts
    instagram: [
      'pages_show_list',
      'pages_messaging'
    ]
  } as const;

  /**
   * Get required scopes for each platform
   * Uses platform-specific scope map to prevent scope bleeding
   */
  private getScopesForPlatform(platform: 'whatsapp' | 'instagram' | 'facebook'): string[] {
    switch (platform) {
      case 'whatsapp':
        // WhatsApp: ONLY WhatsApp Business scopes (NO Page/Messenger scopes)
        return [...MetaOAuthService.META_OAUTH_SCOPES.whatsapp];
      case 'instagram':
        return [...MetaOAuthService.META_OAUTH_SCOPES.instagram];
      case 'facebook':
        // Messenger: ONLY Page/Messenger scopes (NO WhatsApp scopes)
        return [...MetaOAuthService.META_OAUTH_SCOPES.facebook];
      default:
        // Fallback (should never reach here due to TypeScript typing)
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  /**
   * Exchange authorization code for access token
   * @param code - OAuth authorization code
   */
  async exchangeCodeForToken(code: string): Promise<MetaAccessTokenResponse> {
    try {
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          client_id: this.appId,
          client_secret: this.appSecret,
          redirect_uri: this.redirectUri,
          code
        }
      });

      return response.data;
    } catch (error: any) {
      console.error('[Meta OAuth] Error exchanging code for token:', error.response?.data || error.message);
      throw new AppError(
        400,
        'OAUTH_ERROR',
        error.response?.data?.error?.message || 'Failed to exchange authorization code for access token'
      );
    }
  }

  /**
   * Get long-lived access token (valid for 60 days)
   */
  async getLongLivedToken(shortLivedToken: string): Promise<MetaAccessTokenResponse> {
    try {
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: shortLivedToken
        }
      });

      return response.data;
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting long-lived token:', error.response?.data || error.message);
      throw new AppError(
        400,
        'OAUTH_ERROR',
        error.response?.data?.error?.message || 'Failed to get long-lived access token'
      );
    }
  }

  /**
   * Get user's pages (Facebook Pages)
   * Returns pages with access tokens for Messenger API
   */
  async getUserPages(accessToken: string): Promise<MetaPage[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/me/accounts`, {
        params: {
          access_token: accessToken,
          fields: 'id,name,access_token,category' // Matching Python reference: id,name,access_token,category
        }
      });

      return response.data.data || [];
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting user pages:', error.response?.data || error.message);
      throw new AppError(
        400,
        'OAUTH_ERROR',
        error.response?.data?.error?.message || 'Failed to get user pages'
      );
    }
  }

  /**
   * Get Instagram accounts connected to a Facebook Page
   */
  async getInstagramAccounts(pageId: string, pageAccessToken: string): Promise<MetaInstagramAccount[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${pageId}`, {
        params: {
          access_token: pageAccessToken,
          fields: 'instagram_business_account{id,username,name}'
        }
      });

      const instagramAccount = response.data.instagram_business_account;
      if (!instagramAccount) {
        return [];
      }

      return [{
        id: instagramAccount.id,
        username: instagramAccount.username,
        name: instagramAccount.name
      }];
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting Instagram accounts:', error.response?.data || error.message);
      // Instagram account might not be connected, return empty array
      return [];
    }
  }

  /**
   * Get businesses that the user belongs to (WhatsApp-specific, no Page endpoints)
   */
  async getUserBusinesses(accessToken: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/me/businesses`, {
        params: {
          access_token: accessToken,
          fields: 'id,name'
        }
      });

      return response.data.data || [];
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting user businesses:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get owned WhatsApp Business Accounts for a business (WhatsApp-specific, no Page endpoints)
   */
  async getOwnedWhatsAppBusinessAccounts(businessId: string, accessToken: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/${businessId}/owned_whatsapp_business_accounts`, {
        params: {
          access_token: accessToken,
          fields: 'id,name'
        }
      });

      return response.data.data || [];
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting owned WhatsApp Business Accounts:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get WhatsApp Business Account ID from a page (DEPRECATED - Use getOwnedWhatsAppBusinessAccounts instead)
   * @deprecated This method uses Page endpoints which require pages_read_engagement. Use getOwnedWhatsAppBusinessAccounts for WhatsApp OAuth.
   */
  async getWhatsAppBusinessAccountId(pageId: string, pageAccessToken: string): Promise<string | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/${pageId}`, {
        params: {
          access_token: pageAccessToken,
          fields: 'whatsapp_business_account'
        }
      });

      return response.data.whatsapp_business_account?.id || null;
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting WhatsApp Business Account:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get phone number ID for WhatsApp
   */
  async getWhatsAppPhoneNumberId(wabaId: string, accessToken: string): Promise<string | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/${wabaId}/phone_numbers`, {
        params: {
          access_token: accessToken,
          fields: 'id,verified_name,display_phone_number'
        }
      });

      const phoneNumbers = response.data.data || [];
      if (phoneNumbers.length > 0) {
        return phoneNumbers[0].id;
      }

      return null;
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting WhatsApp phone number:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get user profile information
   * @param accessToken - User access token
   * @returns User info with id, name, and email
   */
  async getUserInfo(accessToken: string): Promise<{ id: string; name?: string; email?: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,name,email'
        }
      });

      return response.data;
    } catch (error: any) {
      console.error('[Meta OAuth] Error getting user info:', error.response?.data || error.message);
      throw new AppError(
        400,
        'OAUTH_ERROR',
        error.response?.data?.error?.message || 'Failed to get user info'
      );
    }
  }

  /**
   * Subscribe Page to webhooks for Messenger
   * @param pageId - Facebook Page ID
   * @param pageAccessToken - Page Access Token
   * @returns Success status
   */
  async subscribePageToWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
    try {
      const appId = this.appId;
      const response = await axios.post(
        `${this.baseUrl}/${pageId}/subscribed_apps`,
        {
          subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_optins', 'messaging_referrals']
        },
        {
          params: {
            access_token: pageAccessToken
          }
        }
      );

      console.log(`[Meta OAuth] Page ${pageId} subscribed to webhooks:`, response.data);
      return response.data.success === true;
    } catch (error: any) {
      console.error(`[Meta OAuth] Error subscribing page to webhooks:`, error.response?.data || error.message);
      // Don't throw - webhook subscription might already be active
      return false;
    }
  }

  /**
   * Send Messenger message via Graph API
   * @param pageId - Facebook Page ID
   * @param pageAccessToken - Page Access Token
   * @param recipientId - Recipient PSID (Page-scoped ID)
   * @param messageText - Message text to send
   * @returns Message ID if successful
   */
  async sendMessengerMessage(
    pageId: string,
    pageAccessToken: string,
    recipientId: string,
    messageText: string
  ): Promise<string | null> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${pageId}/messages`,
        {
          recipient: { id: recipientId },
          message: { text: messageText },
          messaging_type: 'RESPONSE'
        },
        {
          params: {
            access_token: pageAccessToken
          }
        }
      );

      console.log(`[Meta Messenger] Message sent successfully:`, response.data);
      return response.data.message_id || null;
    } catch (error: any) {
      console.error(`[Meta Messenger] Error sending message:`, error.response?.data || error.message);
      throw new AppError(
        400,
        'MESSENGER_SEND_ERROR',
        error.response?.data?.error?.message || 'Failed to send Messenger message'
      );
    }
  }

  /**
   * Verify access token
   */
  async verifyToken(accessToken: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,name'
        }
      });

      return !!response.data.id;
    } catch (error) {
      return false;
    }
  }
}

