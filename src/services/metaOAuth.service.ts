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
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(config: MetaOAuthConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.redirectUri = config.redirectUri;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(
    platform: 'whatsapp' | 'instagram' | 'facebook',
    state: string
  ): string {
    const scopes = this.getScopesForPlatform(platform);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      state,
      scope: scopes.join(','),
      response_type: 'code',
      auth_type: 'rerequest' // Force re-authentication to get fresh permissions
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Get required scopes for each platform
   */
  private getScopesForPlatform(platform: 'whatsapp' | 'instagram' | 'facebook'): string[] {
    switch (platform) {
      case 'whatsapp':
        return [
          'business_management', // Required for Business Manager access
          'pages_show_list', // List user's pages
          'pages_read_engagement', // Read page engagement
          'whatsapp_business_management', // WhatsApp Business API management
          'whatsapp_business_messaging' // WhatsApp messaging
        ];
      case 'instagram':
        return [
          'business_management', // Required for Business Manager access
          'pages_show_list', // List user's pages
          'pages_read_engagement', // Read page engagement
          'instagram_basic', // Instagram basic access
          'instagram_manage_messages' // Instagram messaging
        ];
      case 'facebook':
        return [
          'business_management', // Required for Business Manager access
          'pages_show_list', // List user's pages
          'pages_read_engagement', // Read page engagement
          'pages_messaging', // Send and receive messages (this is the correct scope for Messenger)
          'pages_read_user_content' // Read user content
        ];
      default:
        return baseScopes;
    }
  }

  /**
   * Exchange authorization code for access token
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
   */
  async getUserPages(accessToken: string): Promise<MetaPage[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/me/accounts`, {
        params: {
          access_token: accessToken,
          fields: 'id,name,access_token,category,tasks'
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
   * Get WhatsApp Business Account ID from a page
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

