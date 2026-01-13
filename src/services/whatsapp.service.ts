import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

export class WhatsAppService {
  private apiUrl: string;
  private accessToken: string;
  private phoneNumberId: string;

  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL!;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
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

