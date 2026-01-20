import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  components?: any[];
}

export interface SendTemplateMessageResponse {
  success: boolean;
  message_id?: string;
  raw?: any;
  error?: {
    message: string;
    code?: number;
    details?: any;
  };
}

export class WhatsAppService {
  private apiUrl: string;
  private accessToken: string;
  private phoneNumberId: string;
  private graphApiBaseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL!;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  }

  /**
   * Send WhatsApp template message via Graph API
   * Uses USER ACCESS TOKEN from SocialIntegration (not Page Access Token)
   * 
   * @param userAccessToken - Decrypted USER access token from SocialIntegration.credentials.apiKey
   * @param params - Template message parameters
   * @returns Response with success status and message_id
   */
  async sendTemplateMessage(
    userAccessToken: string,
    params: SendTemplateMessageParams
  ): Promise<SendTemplateMessageResponse> {
    try {
      const { phoneNumberId, to, templateName, languageCode = 'en_US', components = [] } = params;

      // Validate required parameters
      if (!phoneNumberId || !to || !templateName) {
        throw new AppError(
          400,
          'MISSING_PARAMETERS',
          'phoneNumberId, to, and templateName are required'
        );
      }

      // Build payload exactly as specified
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode }
        }
      };

      // Add components if provided
      if (components && components.length > 0) {
        payload.template.components = components;
      }

      // Call Graph API
      const response = await axios.post(
        `${this.graphApiBaseUrl}/${phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Log full response in dev mode
      if (process.env.NODE_ENV !== 'production') {
        console.log('[WhatsApp Template] Full Graph API response:', JSON.stringify(response.data, null, 2));
      }

      // Extract message_id from response
      const messageId = response.data.messages?.[0]?.id;

      return {
        success: true,
        message_id: messageId,
        raw: response.data
      };

    } catch (error: any) {
      // Extract error details from Graph API response
      const errorData = error.response?.data?.error || {};
      
      // Log full error in dev mode
      if (process.env.NODE_ENV !== 'production') {
        console.error('[WhatsApp Template] Graph API error:', JSON.stringify(error.response?.data, null, 2));
      }

      // Throw AppError with Graph API error details
      throw new AppError(
        error.response?.status || 500,
        'WHATSAPP_TEMPLATE_ERROR',
        errorData.message || error.message || 'Failed to send WhatsApp template message',
        {
          code: errorData.code || error.response?.status,
          ...(errorData.error_subcode && { error_subcode: errorData.error_subcode }),
          ...(errorData.error_user_title && { error_user_title: errorData.error_user_title }),
          ...(errorData.error_user_msg && { error_user_msg: errorData.error_user_msg })
        }
      );
    }
  }

  async sendTemplate(
    phoneNumber: string,
    templateName: string,
    languageCode: string,
    variables: Record<string, string> = {}
  ): Promise<{ messageId: string }> {
    try {
      const components = [];

      // Add variables to body component
      if (Object.keys(variables).length > 0) {
        components.push({
          type: 'body',
          parameters: Object.values(variables).map(value => ({
            type: 'text',
            text: value
          }))
        });
      }

      const response = await axios.post(
        `${this.apiUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return { messageId: response.data.messages[0].id };

    } catch (error: any) {
      console.error('WhatsApp API Error:', error.response?.data || error.message);
      throw new AppError(
        500,
        'EXTERNAL_SERVICE_ERROR',
        `Failed to send WhatsApp message: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  async getTemplates(): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          params: {
            limit: 100
          }
        }
      );

      return response.data.data || [];

    } catch (error: any) {
      console.error('WhatsApp Templates Error:', error.response?.data || error.message);
      return []; // Return empty array if API fails
    }
  }

  async getMessageStatus(messageId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return response.data;

    } catch (error: any) {
      console.error('WhatsApp Status Error:', error.response?.data || error.message);
      return null;
    }
  }
}

export const whatsappService = new WhatsAppService();

