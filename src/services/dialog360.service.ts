import axios, { AxiosInstance } from 'axios';

export interface Dialog360Config {
  apiKey: string;
  phoneNumberId?: string;
  instagramAccountId?: string;
  facebookPageId?: string;
}

export interface SendMessageParams {
  to: string;
  type: 'text' | 'image' | 'video' | 'document' | 'audio';
  text?: string;
  mediaUrl?: string;
  caption?: string;
}

export interface Dialog360Message {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'voice';
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename: string };
  audio?: { id: string; mime_type: string };
}

export class Dialog360Service {
  private client: AxiosInstance;
  private config: Dialog360Config;

  constructor(config: Dialog360Config) {
    this.config = config;
    
    // Auto-detect sandbox vs production based on API key prefix
    // Sandbox keys typically start with specific patterns
    const isSandbox = config.apiKey.includes('SANDBOX') || 
                      config.apiKey.startsWith('AK0') || 
                      !config.phoneNumberId;
    
    const baseURL = isSandbox 
      ? 'https://waba-sandbox.360dialog.io/v1'
      : 'https://waba.360dialog.io/v1';
    
    console.log(`[360dialog] Using ${isSandbox ? 'SANDBOX' : 'PRODUCTION'} mode`);
    
    this.client = axios.create({
      baseURL,
      headers: {
        'D360-API-KEY': config.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * Send WhatsApp message
   */
  async sendWhatsAppMessage(params: SendMessageParams): Promise<any> {
    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.to,
        type: params.type
      };

      if (params.type === 'text' && params.text) {
        payload.text = { body: params.text };
      } else if (params.type === 'image' && params.mediaUrl) {
        payload.image = {
          link: params.mediaUrl,
          caption: params.caption || ''
        };
      } else if (params.type === 'video' && params.mediaUrl) {
        payload.video = {
          link: params.mediaUrl,
          caption: params.caption || ''
        };
      } else if (params.type === 'document' && params.mediaUrl) {
        payload.document = {
          link: params.mediaUrl,
          caption: params.caption || ''
        };
      }

      const response = await this.client.post(
        `/messages`,
        payload
      );

      return response.data;
    } catch (error: any) {
      console.error('360dialog WhatsApp send error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to send WhatsApp message');
    }
  }

  /**
   * Send Instagram message
   */
  async sendInstagramMessage(params: SendMessageParams): Promise<any> {
    try {
      if (!this.config.instagramAccountId) {
        throw new Error('Instagram account ID not configured');
      }

      const payload: any = {
        recipient: { id: params.to },
        message: {}
      };

      if (params.type === 'text' && params.text) {
        payload.message.text = params.text;
      } else if (params.type === 'image' && params.mediaUrl) {
        payload.message.attachment = {
          type: 'image',
          payload: { url: params.mediaUrl }
        };
      }

      const response = await this.client.post(
        `/instagram/${this.config.instagramAccountId}/messages`,
        payload
      );

      return response.data;
    } catch (error: any) {
      console.error('360dialog Instagram send error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to send Instagram message');
    }
  }

  /**
   * Send Facebook message
   */
  async sendFacebookMessage(params: SendMessageParams): Promise<any> {
    try {
      if (!this.config.facebookPageId) {
        throw new Error('Facebook page ID not configured');
      }

      const payload: any = {
        recipient: { id: params.to },
        message: {}
      };

      if (params.type === 'text' && params.text) {
        payload.message.text = params.text;
      } else if (params.type === 'image' && params.mediaUrl) {
        payload.message.attachment = {
          type: 'image',
          payload: { url: params.mediaUrl }
        };
      }

      const response = await this.client.post(
        `/messenger/${this.config.facebookPageId}/messages`,
        payload
      );

      return response.data;
    } catch (error: any) {
      console.error('360dialog Facebook send error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to send Facebook message');
    }
  }

  /**
   * Verify webhook connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      // Try multiple endpoints to verify connection (sandbox vs production)
      
      // First try: webhook config endpoint (works in both sandbox and production)
      try {
        const response = await this.client.get('/configs/webhook');
        if (response.status === 200) {
          console.log('[360dialog] Connection verified via webhook config');
          return true;
        }
      } catch (e) {
        // Continue to next method
      }
      
      // Second try: profile/about endpoint
      try {
        const response = await this.client.get('/settings/profile/about');
        if (response.status === 200) {
          console.log('[360dialog] Connection verified via profile');
          return true;
        }
      } catch (e) {
        // Continue to next method
      }
      
      // Third try: settings/application (production only)
      try {
        const response = await this.client.get('/settings/application');
        if (response.status === 200) {
          console.log('[360dialog] Connection verified via application settings');
          return true;
        }
      } catch (e) {
        // All methods failed
      }
      
      console.error('[360dialog] All verification methods failed');
      return false;
    } catch (error: any) {
      console.error('[360dialog] Connection verification error:', error.message);
      return false;
    }
  }

  /**
   * Get phone number info (for WhatsApp)
   */
  async getPhoneNumberInfo(): Promise<any> {
    try {
      const response = await this.client.get('/settings/profile/about');
      return response.data;
    } catch (error: any) {
      console.error('Error fetching phone number info:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Download media from 360dialog
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      const response = await this.client.get(`/media/${mediaId}`, {
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      console.error('Error downloading media:', error.response?.data || error.message);
      throw new Error('Failed to download media');
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string, platform: 'whatsapp' | 'instagram' | 'facebook'): Promise<void> {
    try {
      if (platform === 'whatsapp') {
        await this.client.post('/messages', {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        });
      }
      // Instagram and Facebook have different read receipt mechanisms
    } catch (error: any) {
      console.error('Error marking message as read:', error.response?.data || error.message);
    }
  }
}

export default Dialog360Service;

