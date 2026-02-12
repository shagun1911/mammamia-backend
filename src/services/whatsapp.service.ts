import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

/**
 * Count parameters in a text string by counting {{number}} placeholders
 */
function countParamsFromText(text: string | null | undefined): number {
  if (!text) return 0;
  const matches = text.match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}

/**
 * Extract enriched metadata from WhatsApp template for UI rendering
 * Includes parameter counts and preview text for body and header
 */
export function extractEnrichedTemplateMetadata(template: any): {
  bodyParamCount: number;
  headerParamCount: number;
  buttonParamCount: number;
  totalParamCount: number;
  bodyPreview: string | null;
  headerPreview: string | null;
} {
  let bodyParamCount = 0;
  let headerParamCount = 0;
  let buttonParamCount = 0;
  let bodyPreview: string | null = null;
  let headerPreview: string | null = null;

  if (template.components && Array.isArray(template.components)) {
    for (const component of template.components) {
      if (component.type === 'BODY') {
        const text = component.text || '';
        bodyPreview = text;
        bodyParamCount = countParamsFromText(text);
      } else if (component.type === 'HEADER') {
        if (component.format === 'TEXT') {
          const text = component.text || '';
          headerPreview = text;
          headerParamCount = countParamsFromText(text);
        }
      } else if (component.type === 'BUTTONS') {
        if (Array.isArray(component.buttons)) {
          for (const button of component.buttons) {
            if (button.type === 'URL' && button.url) {
              buttonParamCount += countParamsFromText(button.url);
            }
          }
        }
      }
    }
  }

  const totalParamCount = bodyParamCount + headerParamCount + buttonParamCount;

  return {
    bodyParamCount,
    headerParamCount,
    buttonParamCount,
    totalParamCount,
    bodyPreview,
    headerPreview
  };
}

/**
 * Extract parameter counts from WhatsApp template metadata
 * Counts {{1}}, {{2}}, etc. placeholders in body, header, and button components
 */
export function extractTemplateParamCounts(template: any): {
  bodyParamCount: number;
  headerParamCount: number;
  buttonParamCount: number;
  totalParamCount: number;
} {
  let bodyParamCount = 0;
  let headerParamCount = 0;
  let buttonParamCount = 0;

  const placeholderRegex = /\{\{(\d+)\}\}/g;
  
  if (template.components && Array.isArray(template.components)) {
    for (const component of template.components) {
      if (component.type === 'BODY') {
        const text = component.text || '';
        const matches = text.match(placeholderRegex);
        if (matches) {
          // Get highest number to count total unique placeholders
          const numbers = matches.map((m: string) => parseInt(m.match(/\d+/)![0]));
          bodyParamCount = Math.max(...numbers, 0);
        }
      } else if (component.type === 'HEADER') {
        if (component.format === 'TEXT') {
          const text = component.text || '';
          const matches = text.match(placeholderRegex);
          if (matches) {
            const numbers = matches.map((m: string) => parseInt(m.match(/\d+/)![0]));
            headerParamCount = Math.max(...numbers, 0);
          }
        }
      } else if (component.type === 'BUTTONS') {
        if (Array.isArray(component.buttons)) {
          for (const button of component.buttons) {
            if (button.type === 'URL' && button.url) {
              const matches = button.url.match(placeholderRegex);
              if (matches) {
                const numbers = matches.map((m: string) => parseInt(m.match(/\d+/)![0]));
                buttonParamCount = Math.max(buttonParamCount, ...numbers, 0);
              }
            }
          }
        }
      }
    }
  }

  const totalParamCount = bodyParamCount + headerParamCount + buttonParamCount;

  return {
    bodyParamCount,
    headerParamCount,
    buttonParamCount,
    totalParamCount
  };
}

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string; // Required: Must come from template metadata
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
      const { phoneNumberId, to, templateName, languageCode, components = [] } = params;

      // Validate required parameters
      if (!phoneNumberId || !to || !templateName) {
        throw new AppError(
          400,
          'MISSING_PARAMETERS',
          'phoneNumberId, to, and templateName are required'
        );
      }

      // CRITICAL: Language code must be provided (no defaults, no fallbacks)
      if (!languageCode || languageCode.trim() === '') {
        throw new AppError(
          400,
          'MISSING_LANGUAGE_CODE',
          'WhatsApp template languageCode is required. It must come from the selected template metadata. ' +
          'Do NOT use defaults like "en_US". The language must match the actual template language selected in the UI.'
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

      // Handle parameter mismatch error specifically
      if (errorData.code === 132000 || errorData.message?.includes('Number of parameters')) {
        const errorDetails = errorData.error_data?.details || '';
        const expectedParamsMatch = errorDetails.match(/expected number of params \((\d+)\)/);
        const providedParamsMatch = errorDetails.match(/localizable_params \((\d+)\)/);
        
        const expectedCount = expectedParamsMatch ? parseInt(expectedParamsMatch[1]) : null;
        const providedCount = providedParamsMatch ? parseInt(providedParamsMatch[1]) : 0;
        
        const templateName = params.templateName || 'unknown';
        let helpfulMessage = `WhatsApp template "${templateName}" requires ${expectedCount || 'some'} parameter(s), but ${providedCount} were provided. `;
        helpfulMessage += `Please add the required components JSON in your automation node configuration. `;
        helpfulMessage += `Example format: [{"type": "body", "parameters": [{"type": "text", "text": "value1"}, ...]}]`;
        
        throw new AppError(
          error.response?.status || 400,
          'WHATSAPP_TEMPLATE_PARAMETER_MISMATCH',
          helpfulMessage,
          {
            code: errorData.code || 132000,
            expectedParams: expectedCount,
            providedParams: providedCount,
            templateName: templateName,
            ...(errorData.error_subcode && { error_subcode: errorData.error_subcode }),
            ...(errorData.error_user_title && { error_user_title: errorData.error_user_title }),
            ...(errorData.error_user_msg && { error_user_msg: errorData.error_user_msg })
          }
        );
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

