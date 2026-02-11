import mongoose from 'mongoose';
import Automation from '../models/Automation';
import AutomationExecution from '../models/AutomationExecution';
import Customer from '../models/Customer';
import ContactListMember from '../models/ContactListMember';
import Campaign from '../models/Campaign';
import PhoneSettings from '../models/PhoneSettings';
import Organization from '../models/Organization';
import { WhatsAppService } from './whatsapp.service';
import { AppError } from '../middleware/error.middleware';
import axios from 'axios';
import { trackUsage } from '../middleware/profileTracking.middleware';
import { profileService } from './profile.service';
import { googleCalendarService } from './googleCalendar.service';
import { googleSheetsService } from './googleSheets.service';
import gmailOAuthService from './gmailOAuth.service';
import { emailService } from './email.service';
import GoogleIntegration from '../models/GoogleIntegration';
import SocialIntegration from '../models/SocialIntegration';


// Voice ID mapping from voice name to ElevenLabs voice ID
const VOICE_ID_MAP: Record<string, string> = {
  'domenico': 'QABTI1ryPrQsJUflbKB7',
  'thomas': 'CITWdMEsnRduEUkNWXQv',
  'mario': 'irAl0cku0Hx4TEUJ8d1Q',
  'gianp': 'SpoXt7BywHwFLisCTpQ3',
  'vittorio': 'nH7uLS5UdEnvKEOAXtlQ',
  'ginevra': 'QITiGyM4owEZrBEf0QV8',
  'roberta': 'ZzFXkjuO1rPntDj6At5C',
  'giusy': '8KInRSd4DtD5L5gK7itu',
  'roxy': 'mGiFn5Udfw93ewbgFHaP',
  'sami': 'kAzI34nYjizE0zON6rXv',
  'alejandro': 'YKUjKbMlejgvkOZlnnvt',
  'antonio': 'htFfPSZGJwjBv1CL0aMD',
  'el_faraon': '8mBRP99B2Ng2QwsJMFQl',
  'lumina': 'x5IDPSl4ZUbhosMmVFTk',
  'elena': 'tXgbXPnsMpKXkuTgvE3h',
  'sara': 'gD1IexrzCvsXPHUuT0s3',
  'zara': 'jqcCZkN6Knx8BJ5TBdYR',
  'brittney': 'kPzsL2i3teMYv0FxEYQ6',
  'julieanne': '8WaMCGQzWsKvf7sGPqjE',
  'allison': 'xctasy8XvGp2cVO9HL9k',
  'jameson': 'Mu5jxyqZOLIGltFpfalg',
  'mark': 'UgBBYS2sOqTuMpoF3BR0',
  'archie': 'kmSVBPu7loj4ayNinwWM',
  'adam': 'pNInz6obpgDQGcFmaJgB',
};

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '1' + cleaned;
  return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
}

// Global interface for cross-action context truth
export interface IAutomationExecutionContext {
  contact: any;
  conversation?: any;
  triggerData: any;
  appointment?: {
    booked: boolean;
    date?: string;
    time?: string;
    confidence?: number;
    raw_transcript?: string;
  };
  organizationId: string;
  userId: string;
  now: string;
}

interface TriggerHandler {
  validate(config: any, data: any): Promise<boolean>;
}

interface ActionHandler {
  execute(config: any, triggerData: any, context?: any): Promise<any>;
}

export class AutomationEngine {
  private triggers: Map<string, TriggerHandler>;
  private actions: Map<string, ActionHandler>;
  private whatsappService: WhatsAppService;

  constructor() {
    this.triggers = new Map();
    this.actions = new Map();
    this.whatsappService = new WhatsAppService();

    this.registerHandlers();
  }

  /**
   * Resolve dynamic variables in text using trigger data with strict validation.
   * If any {{variable}} remains, it throws an error to prevent silent corruption.
   */
  private async resolveTemplate(template: string, context: IAutomationExecutionContext): Promise<string> {
    if (!template || typeof template !== 'string') return template;
    let resolved = template;

    const data: Record<string, any> = {
      ...context.triggerData,
      contact: context.contact,
      appointment: context.appointment,
      conversation: context.conversation,
      now: context.now
    };

    // Add computed time variables for appointment scheduling
    if (context.appointment?.time) {
      const timeParts = context.appointment.time.split(':');
      const hour = parseInt(timeParts[0], 10);
      const minute = parseInt(timeParts[1] || '0', 10);
      
      // Calculate time + 30 minutes
      const totalMinutes = hour * 60 + minute + 30;
      const newHour = Math.floor(totalMinutes / 60) % 24;
      const newMinute = totalMinutes % 60;
      
      data.appointment = {
        ...data.appointment,
        time_plus_30: `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}`
      };
    }

    // 1. Resolve nested contact/appointment/conversation properties
    // e.g. {{contact.name}}, {{appointment.booked}}
    resolved = resolved.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, type, key) => {
      const value = data[type]?.[key];
      return value !== undefined && value !== null ? String(value) : match;
    });

    // 2. Resolve flat triggerData properties
    // e.g. {{conversation_id}}, {{call_name}}
    resolved = resolved.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = data[key];
      return value !== undefined && value !== null ? String(value) : match;
    });

    // 🛡️ CRITICAL GUARD: Ensure no unresolved placeholders remain
    if (resolved.includes('{{')) {
      const missing = resolved.match(/\{\{([^}]+)\}\}/g);
      console.error(`[Automation Engine] ❌ Template resolution failed. Missing variables: ${missing?.join(', ')}`);
      throw new Error(`Unresolved variables in template: ${missing?.join(', ')}`);
    }

    return resolved;
  }

  private registerHandlers() {
    // ============ AISTEIN-IT TRIGGERS ============

    // Contact Created Trigger
    this.triggers.set('keplero_contact_created', {
      validate: async (config, data) => {
        // Trigger fires when a new contact is created
        return data.event === 'contact_created';
      }
    });

    // Contact Deleted Trigger
    this.triggers.set('keplero_contact_deleted', {
      validate: async (config, data) => {
        return data.event === 'contact_deleted';
      }
    });

    // Contact Moved to List Trigger
    this.triggers.set('keplero_contact_moved', {
      validate: async (config, data) => {
        // Check if contact was moved to the specified list
        return data.event === 'contact_moved' &&
          (!config.listId || data.listId === config.listId);
      }
    });

    // Batch Call / Mass Sending Trigger
    this.triggers.set('batch_call', {
      validate: async (config, data) => {
        // payload: { event: 'batch_call', source: 'csv'|'list', contactIds: [], listId?: string }
        if (data.event !== 'batch_call') return false;

        // Filter by source if configured (optional)
        if (config.source && data.source !== config.source) return false;

        // Filter by listId if configured (mandatory if source is 'list' in config)
        if (config.source === 'list' && config.listId && data.listId !== config.listId) return false;

        return true;
      }
    });

    // Batch Call Completed Trigger (New - Event-Driven)
    this.triggers.set('batch_call_completed', {
      validate: async (config, data) => {
        // payload: { event: 'batch_call_completed', batch_id, conversation_id, contact, organizationId }
        return data.event === 'batch_call_completed';
      }
    });

    // Conversation Created Trigger (Batch call finishes -> Conversations created)
    this.triggers.set('conversation_created', {
      validate: async (config, data) => {
        return data.event === 'conversation_created';
      }
    });

    // Legacy mass sending trigger (redirect to batch_call logic)
    this.triggers.set('keplero_mass_sending', {
      validate: async (config, data) => {
        // Support old event names but same filtering logic
        if (data.event !== 'batch_call' && data.event !== 'mass_sending') return false;
        if (config.source && data.source !== config.source) return false;
        if (config.source === 'list' && config.listId && data.listId !== config.listId) return false;
        return true;
      }
    });

    // Legacy triggers (keep for backward compatibility)
    this.triggers.set('facebook_lead', {
      validate: async (config, data) => {
        return data.pageId === config.pageId && data.formId === config.formId;
      }
    });

    // Facebook Messenger Message Trigger
    this.triggers.set('facebook_message', {
      validate: async (config, data) => {
        // Trigger fires when a message is received on Facebook Messenger
        if (data.event !== 'message_received') return false;
        
        // If pageId is configured, match it
        if (config.pageId && data.pageId !== config.pageId) return false;
        
        return true;
      }
    });

    // Instagram Message Trigger
    this.triggers.set('instagram_message', {
      validate: async (config, data) => {
        // Trigger fires when a message is received on Instagram
        if (data.event !== 'message_received') return false;
        
        // If instagramAccountId is configured, match it
        if (config.instagramAccountId && data.instagramAccountId !== config.instagramAccountId) return false;
        
        return true;
      }
    });


    this.triggers.set('shopify_order', {
      validate: async (config, data) => {
        return data.storeId === config.storeId;
      }
    });

    this.triggers.set('cart_abandoned', {
      validate: async (config, data) => {
        const abandonedMinutes = (Date.now() - data.abandonedAt) / (1000 * 60);
        return abandonedMinutes >= config.timeThreshold;
      }
    });

    this.triggers.set('webhook', {
      validate: async (config, data) => {
        return data.webhookId === config.webhookId;
      }
    });

    // ============ AISTEIN-IT ACTIONS ============

    // API Call Action
    this.actions.set('keplero_api_call', {
      execute: async (config, triggerData) => {
        const { url, method = 'GET', headers = {}, body, params = {} } = config;

        try {
          const response = await axios({
            method,
            url,
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            params,
            data: body ? JSON.parse(body) : undefined,
            timeout: 30000
          });

          return {
            success: true,
            status: response.status,
            data: response.data
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            status: error.response?.status
          };
        }
      }
    });

    // Create Contact Action
    this.actions.set('keplero_create_contact', {
      execute: async (config, triggerData, context) => {
        const { name, email, phone, tags = [], lists = [] } = config;

        // Get organizationId from context or triggerData
        const organizationId = context?.organizationId || triggerData?.organizationId;
        if (!organizationId) {
          throw new Error('Organization ID is required to create contact');
        }

        // Check if contact already exists (by email and organizationId, or phone and organizationId)
        const duplicateQuery: any = { organizationId };
        if (email) {
          duplicateQuery.email = email.toLowerCase().trim();
        } else if (phone) {
          duplicateQuery.phone = phone;
        }

        let contact;
        if (email || phone) {
          contact = await Customer.findOne(duplicateQuery);
        }

        if (contact) {
          return { success: false, message: 'Contact already exists', contactId: contact._id };
        }

        // Create new contact with organizationId
        contact = await Customer.create({
          name,
          email: email ? email.toLowerCase().trim() : undefined,
          phone,
          tags,
          organizationId
        });

        // Add to lists
        if (lists && lists.length > 0) {
          for (const listId of lists) {
            await ContactListMember.create({
              contactId: contact._id,
              listId
            }).catch(() => { });
          }
        }

        return {
          success: true,
          contactId: contact._id,
          message: 'Contact created successfully'
        };
      }
    });

    // Outbound Call Action
    this.actions.set('keplero_outbound_call', {
      execute: async (config, triggerData, context) => {
        const agentId = triggerData?.agent_id || config.agent_id;
        const phoneNumberId = triggerData?.phone_number_id || config.phone_number_id;
        const organizationId = context?.organizationId || triggerData?.organizationId;
        const contactId = triggerData.contactId || config.contactId;

        // Fetch contact if not in context
        let contact = context?.contact || triggerData?.contact;
        if (!contact && contactId) {
          const Customer = (await import('../models/Customer')).default;
          contact = await Customer.findById(contactId).lean();
        }

        if (!contact?.phone) {
          throw new Error('Contact phone number is required for outbound call');
        }

        if (!agentId) throw new Error('Agent ID (Voice Agent) is required. Please select one in the automation builder.');
        if (!phoneNumberId) throw new Error('Phone number is required. Please select one in the automation builder.');

        console.log(`[Automation Engine] ⚡ Executing unified outbound call for contact ${contact._id || contact.id}`);

        return await this.performUnifiedOutboundCall({
          contact,
          agent_id: agentId,
          phone_number_id: phoneNumberId,
          organizationId: organizationId || (contact as any).organizationId,
          userId: context?.userId,
          dynamicVars: triggerData?.dynamic_variables
        });
      }
    });
    this.actions.set('keplero_batch_calling', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const { listId, agent_id, phone_number_id, call_name } = config;

        if (!agent_id) throw new Error('Agent ID (Voice Agent) is required.');
        if (!phone_number_id) throw new Error('Phone number ID is required.');

        // Resolve recipients
        let contacts: any[] = [];
        if (listId) {
          const ContactListMember = (await import('../models/ContactListMember')).default;
          const members = await ContactListMember.find({ listId }).lean();
          const contactIds = members.map(m => m.contactId);
          contacts = await Customer.find({ _id: { $in: contactIds } }).lean();
        } else if (triggerData?.contactIds) {
          contacts = await Customer.find({ _id: { $in: triggerData.contactIds } }).lean();
        }

        if (contacts.length === 0) throw new Error('No recipients found for batch call.');

        console.info(`[Automation Engine] 🚀 Dispatching batch call: ${call_name} to ${contacts.length} recipients`);

        const batchResults = [];
        for (const contact of contacts) {
          if (!contact.phone) {
            batchResults.push({ contactId: contact._id, success: false, error: 'Missing phone' });
            continue;
          }
          try {
            await this.performUnifiedOutboundCall({
              contact,
              agent_id,
              phone_number_id,
              organizationId: context.organizationId,
              userId: context.userId,
              dynamicVars: { ...triggerData, batch_call_name: call_name }
            });
            batchResults.push({ contactId: contact._id, success: true });
          } catch (err: any) {
            console.error(`[Automation Engine] ❌ Batch entry failed for ${contact.phone}:`, err.message);
            batchResults.push({ contactId: contact._id, success: false, error: err.message });
          }
          // Throttle to 2 calls/sec to avoid Twilio bursting
          await new Promise(r => setTimeout(r, 500));
        }

        return {
          success: true,
          total: contacts.length,
          results: batchResults
        };
      }
    });

    // Extract Data Action
    this.actions.set('keplero_extract_data', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const conversationId = triggerData.conversation_id || config.conversation_id;
        const extractionType = config.extraction_type || 'appointment';

        if (!conversationId) throw new Error('Conversation ID is required for extraction.');

        const { automationService } = await import('./automation.service');
        const result = await automationService.extractConversationData(
          conversationId,
          extractionType,
          context.organizationId
        );

        // 🧬 UPDATE CONTEXT: Store extracted data for downstream actions
        if (result?.appointment) {
          context.appointment = {
            booked: result.appointment.booked === true || result.appointment.booked === 'true',
            date: result.appointment.date,
            time: result.appointment.time,
            confidence: result.confidence,
            raw_transcript: result.raw_transcript
          };
        }

        return result;
      }
    });


    // SMS Sending Action
    this.actions.set('keplero_send_sms', {
      execute: async (config, triggerData) => {
        const contactId = triggerData.contactId || config.contactId;
        const message = config.message || '';

        if (!contactId) {
          throw new Error('Contact ID is required for SMS');
        }

        const contact = await Customer.findById(contactId);
        if (!contact || !contact.phone) {
          throw new Error('Contact not found or phone number missing');
        }

        try {
          // Normalize phone number to E.164 format
          const normalizedPhone = normalizePhoneNumber(contact.phone);

          console.log(`[Automation Engine] Sending SMS to ${normalizedPhone}...`);
          // Use PYTHON_API_URL or fallback
          const COMM_API = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';
          const smsResponse = await axios.post(`${COMM_API}/sms/send`, {
            body: message,
            number: normalizedPhone,
          }, {
            timeout: 30000, // 30 seconds timeout
          });

          console.log(`[Automation Engine] SMS to ${contact.phone} completed with status: ${smsResponse.data.status}`);

          return {
            success: smsResponse.data.status === 'success',
            contactId: contact._id,
            phone: contact.phone,
            message,
            sentAt: new Date()
          };
        } catch (error: any) {
          console.error(`[Automation Engine] SMS to ${contact.phone} failed:`, error.response?.data?.detail || error.message);
          return {
            success: false,
            error: error.response?.data?.detail || error.message,
            contactId: contact._id,
            phone: contact.phone
          };
        }
      }
    });

    // Email Sending Action
    this.actions.set('keplero_send_email', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const { subject, body, to, is_html } = config;

        // 1. Resolve recipient email via dynamic template resolution
        const resolvedTo = to ? await this.resolveTemplate(to, context) : context.contact.email;
        if (!resolvedTo || !resolvedTo.includes('@')) {
          console.warn(`[Automation Engine] ⏭️ Skipping Email: Invalid recipient address: ${resolvedTo}`);
          return { success: true, status: 'skipped', reason: 'Invalid email' };
        }

        // 2. Resolve content (Subject & Body)
        // If resolution fails (unresolved variables), it will throw here (Task 4)
        const emailSubject = await this.resolveTemplate(subject || 'Notification', context);
        const emailBody = await this.resolveTemplate(body || '', context);

        try {
          const fromEmail = process.env.EMAIL_FROM || undefined;
          const emailResult = await emailService.sendEmail({
            to: resolvedTo,
            subject: emailSubject,
            ...(is_html ? { html: emailBody } : { text: emailBody }),
            from: fromEmail
          });

          if (!emailResult.success) throw new Error(emailResult.error || 'SMTP delivery failed');

          return {
            success: true,
            status: 'completed',
            recipient: resolvedTo,
            messageId: emailResult.messageId
          };
        } catch (error: any) {
          console.error(`[Automation Engine] ❌ Email to ${resolvedTo} failed:`, error.message);
          return { success: true, status: 'failed', error: error.message };
        }
      }
    });

    // WhatsApp Template Action
    this.actions.set('send_whatsapp', {
      execute: async (config, triggerData, context) => {
        const {
          templateName,
          template,
          templateId,
          phoneNumberId,
          to,
          delay,
          delayUnit,
          languageCode = 'en_US',
          components,
          templateParams, // New: Simple array of parameter values
          mode,
          accessToken
        } = config;
        const contactId = triggerData.contactId;

        // Check Credits
        const organizationId = context?.organizationId || triggerData?.organizationId;
        if (organizationId) {
             const hasCredit = await profileService.checkCredits(organizationId, 'chat', 1);
             if (!hasCredit) throw new AppError(403, 'LIMIT_REACHED', 'Chat messages (WhatsApp) limit reached. Please upgrade your plan.');
        }

        if (delay && delay > 0) {
          await this.delay(delay, delayUnit);
        }

        // Resolve phoneNumberId and access token based on mode
        let resolvedPhoneNumberId = phoneNumberId;
        let userAccessToken: string | null = null;

        // Manual mode: use credentials stored directly on config
        if (mode === 'manual') {
          if (config.phoneNumberId) {
            resolvedPhoneNumberId = config.phoneNumberId;
          }
          if (accessToken) {
            userAccessToken = accessToken;
          }
        }

        // Automatic mode (default): resolve from SocialIntegration if not provided
        if (!resolvedPhoneNumberId || !userAccessToken) {
          const organizationId = context?.organizationId || triggerData?.organizationId;
          if (organizationId) {
            const SocialIntegration = (await import('../models/SocialIntegration')).default;
            const integration = await SocialIntegration.findOne({
              organizationId,
              platform: 'whatsapp',
              status: 'connected'
            });

            if (integration) {
              if (!resolvedPhoneNumberId && integration.credentials?.phoneNumberId) {
                resolvedPhoneNumberId = integration.credentials.phoneNumberId;
              }
              // Decrypt USER access token using model method
              if (!userAccessToken && typeof (integration as any).getDecryptedApiKey === 'function') {
                userAccessToken = (integration as any).getDecryptedApiKey();
              }
            }
          }
        }

        // STRICT VALIDATION: Throw immediately if required fields missing
        if (!resolvedPhoneNumberId || resolvedPhoneNumberId.trim() === '') {
          throw new Error('phoneNumberId is required. Please configure WhatsApp integration or provide phoneNumberId in action config.');
        }

        if (!userAccessToken || userAccessToken.trim() === '') {
          throw new Error('WhatsApp access token not found. Please ensure WhatsApp integration is connected.');
        }

        // Resolve recipient phone number
        let recipientPhone = to;
        if (!recipientPhone && contactId) {
          const contact = await Customer.findById(contactId);
          if (!contact || !contact.phone) {
            throw new Error('Contact not found or phone missing. Please provide "to" field or ensure contact has phone number.');
          }
          recipientPhone = contact.phone;
        }

        if (!recipientPhone || recipientPhone.trim() === '') {
          throw new Error('Recipient phone number (to) is required.');
        }

        // Normalize components: support multiple input formats
        let normalizedComponents: any[] = [];
        
        // Priority 1: Use existing components if provided (advanced/backward compatibility)
        // This allows users to override simple params with complex JSON if needed
        if (components) {
          if (Array.isArray(components)) {
            normalizedComponents = components;
          } else if (typeof components === 'string' && components.trim() !== '') {
            try {
              const parsed = JSON.parse(components);
              if (Array.isArray(parsed)) {
                normalizedComponents = parsed;
              } else {
                console.warn('[Automation Engine] WhatsApp components JSON is not an array, ignoring');
                throw new Error(`WhatsApp components must be a JSON array. Received: ${typeof parsed}. Please format as: [{"type": "body", "parameters": [...]}]`);
              }
            } catch (err: any) {
              if (err.message && err.message.includes('WhatsApp components must be')) {
                throw err; // Re-throw our validation error
              }
              console.warn('[Automation Engine] Failed to parse WhatsApp components JSON:', err);
              throw new Error(`Invalid WhatsApp components JSON format. Please ensure it's valid JSON array. Error: ${err.message}`);
            }
          }
        }
        // Priority 2: Use simple templateParams array (new, user-friendly format)
        // Only use this if components weren't provided
        else if (templateParams && Array.isArray(templateParams) && templateParams.length > 0) {
          // Auto-generate components JSON from simple parameter array
          const bodyParams = templateParams
            .filter((param: any) => param !== null && param !== undefined && param !== '')
            .map((param: any) => ({
              type: 'text',
              text: String(param)
            }));
          
          if (bodyParams.length > 0) {
            normalizedComponents = [{
              type: 'body',
              parameters: bodyParams
            }];
          }
          console.log(`[Automation Engine] Auto-generated components from ${bodyParams.length} template parameters`);
        }
        
        // Log warning if no components provided (templates may require parameters)
        if (normalizedComponents.length === 0) {
          console.warn(`[Automation Engine] No components provided for template "${templateName || template}". If this template requires parameters, the request will fail.`);
        }

        // Use templateName or template (templateName takes precedence)
        // Fallback to a safe default only if nothing is configured
        const resolvedTemplateName = (templateName || template || 'hello_world').trim();
        const resolvedLanguageCode = (languageCode || 'en_US').trim();

        if (!resolvedTemplateName || resolvedTemplateName.trim() === '') {
          throw new Error('templateName is required.');
        }

        // Construct Graph API URL exactly as specified
        const graphApiUrl = `https://graph.facebook.com/v18.0/${resolvedPhoneNumberId}/messages`;

        // Build payload exactly as specified
        const payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: "individual",
          to: recipientPhone,
          type: 'template',
          template: {
            name: resolvedTemplateName,
            language: { code: resolvedLanguageCode }
          }
        };

        // Only include components if explicitly provided and not empty
        if (normalizedComponents && Array.isArray(normalizedComponents) && normalizedComponents.length > 0) {
          payload.template.components = normalizedComponents;
        }

        console.log('[Automation] WhatsApp Template - Final URL and payload:', {
          url: graphApiUrl,
          phoneNumberId: resolvedPhoneNumberId,
          to: recipientPhone,
          templateName: resolvedTemplateName,
          languageCode: resolvedLanguageCode,
          hasComponents: normalizedComponents && normalizedComponents.length > 0,
          payload: JSON.stringify(payload, null, 2)
        });

        try {
          // Use WhatsAppService.sendTemplateMessage with proper parameters
          const result = await this.whatsappService.sendTemplateMessage(userAccessToken, {
            phoneNumberId: resolvedPhoneNumberId,
            to: recipientPhone,
            templateName: resolvedTemplateName,
            languageCode: resolvedLanguageCode,
            components: normalizedComponents && normalizedComponents.length > 0 ? normalizedComponents : []
          });

          // Fail hard on HTTP errors (already handled by sendTemplateMessage throwing AppError)
          if (!result.success) {
            throw new Error(result.error?.message || 'WhatsApp template send failed');
          }

          return {
            success: true,
            messageId: result.message_id,
            result
          };
        } catch (error: any) {
          // Preserve AppError messages (they contain helpful guidance)
          if (error.code === 'WHATSAPP_TEMPLATE_PARAMETER_MISMATCH' || error.message?.includes('parameter')) {
            // Log detailed error info for debugging
            console.error('[Automation Engine] WhatsApp template parameter error:', {
              templateName: resolvedTemplateName,
              hasComponents: normalizedComponents.length > 0,
              componentCount: normalizedComponents.length,
              error: error.message,
              errorCode: error.code
            });
            // Re-throw with context
            throw new Error(
              `WhatsApp Template Error: ${error.message}\n` +
              `Template: ${resolvedTemplateName}\n` +
              `Action: Add the required components JSON in your automation node configuration. ` +
              `Go to the automation builder, select this WhatsApp action node, and fill in the "Components (JSON)" field.`
            );
          }
          // Re-throw other errors as-is (they already have good messages)
          throw error;
        }
      }
    });

    // WhatsApp Template Action (alias for send_whatsapp)
    this.actions.set('whatsapp_template', {
      execute: async (config, triggerData, context) => {
        // Delegate to send_whatsapp handler
        const sendWhatsAppHandler = this.actions.get('send_whatsapp');
        if (!sendWhatsAppHandler) {
          throw new Error('WhatsApp service not available');
        }
        return sendWhatsAppHandler.execute(config, triggerData, context);
      }
    });

    // Legacy actions (FIXED - redirect to real email sender)
    this.actions.set('send_email', {
      execute: async (config, triggerData, context) => {
        const handler = this.actions.get('keplero_send_email');
        if (!handler) {
          throw new Error('keplero_send_email handler not found');
        }
        return handler.execute(config, triggerData, context);
      }
    });

    this.actions.set('save_to_crm', {
      execute: async (config, triggerData, context) => {
        // This is a placeholder action - CRM integration would go here
        // For now, we consider the contact already saved in our database as the "CRM"
        const contactId = triggerData.contactId;
        const contact = await Customer.findById(contactId);

        if (!contact) {
          throw new Error('Contact not found');
        }

        console.log(`[Automation] Contact ${contact.name} (${contactId}) saved to CRM`);

        return {
          saved: true,
          contactId: contact._id,
          contactName: contact.name,
          message: 'Contact already exists in system (CRM)'
        };
      }
    });

    this.actions.set('add_tag', {
      execute: async (config, triggerData, context) => {
        const contact = await Customer.findById(triggerData.contactId);
        if (contact) {
          // Validate organization match if context provided
          const organizationId = context?.organizationId || triggerData?.organizationId;
          if (organizationId && (contact as any).organizationId?.toString() !== organizationId.toString()) {
            throw new Error('Contact does not belong to this organization');
          }

          if (!contact.tags.includes(config.tag)) {
            contact.tags.push(config.tag);
            await contact.save();
            return { added: true, tag: config.tag };
          }
          return { added: false, message: 'Tag already exists' };
        }
        return { added: false, message: 'Contact not found' };
      }
    });

    this.actions.set('add_to_list', {
      execute: async (config, triggerData, context) => {
        // Validate contact exists and belongs to organization
        const contact = await Customer.findById(triggerData.contactId);
        if (!contact) {
          throw new Error('Contact not found');
        }

        const organizationId = context?.organizationId || triggerData?.organizationId || (contact as any).organizationId;
        if (organizationId && (contact as any).organizationId?.toString() !== organizationId.toString()) {
          throw new Error('Contact does not belong to this organization');
        }

        await ContactListMember.create({
          contactId: triggerData.contactId,
          listId: config.listId
        }).catch(() => { });
        return { added: true, listId: config.listId };
      }
    });

    // ============ GOOGLE WORKSPACE ACTIONS ============

    // Extract Appointment Data from Conversation
    this.actions.set('keplero_extract_appointment', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const { conversation_id, extraction_type = 'appointment' } = config;
        
        // Resolve conversation_id from template
        const resolvedConvId = await this.resolveTemplate(conversation_id, context);
        
        if (!resolvedConvId) {
          console.warn(`[Automation Engine] ⚠️ No conversation ID for extraction, skipping`);
          context.appointment = { booked: false };
          return {
            success: true,
            appointment_booked: false,
            error: 'No conversation ID provided',
            skipped: true
          };
        }

        console.log(`[Automation Engine] 🧠 Extracting appointment data from conversation: ${resolvedConvId}`);

        try {
          // Call the automation service extractConversationData method
          const { automationService } = await import('./automation.service');
          const result = await automationService.extractConversationData(
            resolvedConvId,
            extraction_type,
            context.organizationId
          );

          console.log(`[Automation Engine] ✅ Appointment extraction result:`, result);

          // Update context with appointment data
          // ALWAYS return success=true to avoid failing the entire automation
          // The condition node will check appointment_booked to decide whether to continue
          if (result.success && result.appointment_booked) {
            context.appointment = {
              booked: result.appointment_booked,
              date: result.date,
              time: result.time,
              confidence: result.confidence
            };
          } else {
            context.appointment = {
              booked: false
            };
            // Log the reason but don't fail
            console.log(`[Automation Engine] ℹ️ No appointment booked - Reason: ${result.error || 'Not booked'}`);
          }

          return {
            success: true,
            appointment_booked: result.appointment_booked || false,
            date: result.date || null,
            time: result.time || null,
            confidence: result.confidence || 0,
            reason: result.error
          };
        } catch (error: any) {
          console.error(`[Automation Engine] ❌ Appointment extraction failed:`, error);
          context.appointment = { booked: false };
          // Still return success=true to avoid failing entire automation
          return {
            success: true,
            appointment_booked: false,
            error: error.message
          };
        }
      }
    });

    // Google Calendar - Check Availability
    // Google Calendar - Check Availability
    this.actions.set('keplero_google_calendar_check_availability', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        if (!context.appointment?.booked) {
          console.info(`[Automation] ⏭️ Skipping Calendar Check: No booked appointment in context.`);
          return { success: true, status: 'skipped', reason: 'No appointment booked' };
        }

        const integration = await GoogleIntegration.findOne({
          userId: context.userId,
          organizationId: context.organizationId,
          status: 'active',
          'services.calendar': true
        });

        if (!integration) throw new Error('Google Calendar integration not connected');

        const resolvedTimeMin = await this.resolveTemplate(config.timeMin, context);
        const resolvedTimeMax = await this.resolveTemplate(config.timeMax, context);

        const startDate = new Date(resolvedTimeMin);
        const endDate = new Date(resolvedTimeMax || (startDate.getTime() + 60 * 60 * 1000));

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          console.warn(`[Automation] ⚠️ Invalid ISO Dates in Calendar Check. Skipping.`, { resolvedTimeMin, resolvedTimeMax });
          return { success: true, status: 'skipped', reason: 'Invalid date format' };
        }

        try {
          const availability = await googleCalendarService.checkAvailability(
            context.userId,
            context.organizationId,
            startDate,
            endDate
          );
          return { success: true, status: 'completed', availability };
        } catch (error: any) {
          console.error('[Automation] Google Calendar check failed:', error.message);
          return { success: true, status: 'failed', error: error.message };
        }
      }
    });

    // Google Calendar - Create Event
    this.actions.set('keplero_google_calendar_create_event', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        if (!context.appointment?.booked) {
          console.info(`[Automation Engine] ⏭️ Skipping Event Creation: Appointment not confirmed.`);
          return { success: true, status: 'skipped', reason: 'Appointment not booked' };
        }

        // CRITICAL: Skip if date/time are missing
        if (!context.appointment.date || !context.appointment.time) {
          console.warn(`[Automation Engine] ⏭️ Skipping Calendar Event: Missing appointment date/time`);
          return { 
            success: true, 
            status: 'skipped', 
            reason: 'Missing appointment date or time' 
          };
        }

        const { summary, description, startTime, endTime, attendees } = config;
        const resolvedSummary = await this.resolveTemplate(summary, context);
        const resolvedStart = await this.resolveTemplate(startTime, context);
        const resolvedEnd = await this.resolveTemplate(endTime, context);

        const startD = new Date(resolvedStart);
        const endD = new Date(resolvedEnd);

        if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
          throw new Error('Critical: Invalid date/time resolution for calendar event.');
        }

        // Resolve attendees array (handle template variables in emails)
        let resolvedAttendees: Array<{ email: string; displayName?: string }> = [];
        if (Array.isArray(attendees) && attendees.length > 0) {
          for (const attendee of attendees) {
            if (typeof attendee === 'object' && attendee.email) {
              const resolvedEmail = await this.resolveTemplate(attendee.email, context);
              if (resolvedEmail && resolvedEmail.includes('@')) {
                resolvedAttendees.push({
                  email: resolvedEmail,
                  displayName: attendee.displayName || context.contact?.name
                });
              }
            }
          }
        }

        try {
          const event = await googleCalendarService.createEvent(
            context.userId,
            context.organizationId,
            {
              summary: resolvedSummary,
              description: description ? await this.resolveTemplate(description, context) : undefined,
              start: { dateTime: startD.toISOString() },
              end: { dateTime: endD.toISOString() },
              attendees: resolvedAttendees
            }
          );
          return { success: true, status: 'completed', event };
        } catch (error: any) {
          console.error('[Automation] Google Calendar event creation failed:', error.message);
          return { success: true, status: 'failed', error: error.message };
        }
      }
    });

    // Google Sheets - Append Row
    this.actions.set('keplero_google_sheet_append_row', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const { spreadsheetId, values } = config;
        if (!spreadsheetId || !Array.isArray(values)) throw new Error('Sheet configuration missing');

        const integration = await GoogleIntegration.findOne({
          userId: context.userId,
          organizationId: context.organizationId,
          status: 'active',
          'services.sheets': true
        });

        if (!integration) throw new Error('Google Sheets not connected');

        try {
          const { google } = require('googleapis');
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
          );
          oauth2Client.setCredentials({ access_token: integration.accessToken, refresh_token: integration.refreshToken });
          const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

          const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
          const sheetName = sheetMeta.data.sheets?.[0]?.properties?.title || 'Sheet1';

          const resolvedValues = await Promise.all(values.map(v => this.resolveTemplate(String(v), context)));

          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [resolvedValues] }
          });

          return { success: true, status: 'completed' };
        } catch (error: any) {
          console.error('[Automation] Google Sheets error:', error.message);
          return { success: true, status: 'failed', error: error.message };
        }
      }
    });

    // Gmail - Send Email
    this.actions.set('keplero_google_gmail_send', {
      execute: async (config, triggerData, context: IAutomationExecutionContext) => {
        const { to, subject, body } = config;
        
        // CRITICAL: Skip if appointment date/time are missing
        // This prevents failures when appointment is detected but details are unclear
        if (context.appointment) {
          if (!context.appointment.date || !context.appointment.time) {
            console.warn(`[Automation Engine] ⏭️ Skipping Gmail send: Missing appointment date/time`);
            return { 
              success: true, 
              status: 'skipped', 
              reason: 'Missing appointment date or time' 
            };
          }
        }
        
        const integration = await SocialIntegration.findOne({
          userId: context.userId,
          organizationId: context.organizationId,
          platform: 'gmail',
          status: 'connected'
        });

        if (!integration) {
          console.error('[Automation Engine] ❌ Gmail integration not connected');
          throw new Error('Gmail integration not connected');
        }

        const resolvedTo = to ? await this.resolveTemplate(to, context) : context.contact.email;
        if (!resolvedTo) {
          console.error('[Automation Engine] ❌ No recipient email found');
          throw new Error('No recipient email found');
        }

        const resolvedSubject = await this.resolveTemplate(subject, context);
        const resolvedBody = await this.resolveTemplate(body, context);

        try {
          const userEmail = integration.getDecryptedApiKey();
          console.log(`[Automation Engine] 📧 Sending email to: ${resolvedTo}`);
          console.log(`[Automation Engine] Subject: ${resolvedSubject}`);
          
          await gmailOAuthService.sendEmail(userEmail, {
            to: resolvedTo,
            subject: resolvedSubject,
            body: resolvedBody
          });
          
          console.log(`[Automation Engine] ✅ Email sent successfully to ${resolvedTo}`);
          return { success: true, status: 'completed', recipient: resolvedTo };
        } catch (error: any) {
          console.error('[Automation Engine] ❌ Gmail send failed:', error.message);
          throw new Error(`Gmail send failed: ${error.message}`);
        }
      }
    });
  }

  /**
   * Extract sheet name from range for Google Sheets
   */
  private extractSheetNameFromRange(range: string): string {
    if (!range || typeof range !== 'string') return 'Sheet1';
    if (!range.includes('!')) return range.trim();
    const match = range.match(/^(.+?)!/);
    return match && match[1] ? match[1].trim() : 'Sheet1';
  }

  /**
   * Resolve userId from organizationId
   */
  private async resolveUserId(organizationId: any, context?: any): Promise<string | null> {
    if (context?.userId) return context.userId.toString();
    if (context?.automation?.userId) return context.automation.userId.toString();
    if (organizationId) {
      try {
        const org = await Organization.findById(organizationId);
        if (org?.ownerId) return org.ownerId.toString();
      } catch (error) {
        console.error('[Automation Engine] Error resolving userId:', error);
      }
    }
    return null;
  }

  /**
   * Convert Mongoose Map to plain object
   */
  private convertConfigToPlainObject(config: any): Record<string, any> {
    if (!config) return {};
    if (config.constructor === Object) return config;
    if (config instanceof Map) {
      const plainObj: Record<string, any> = {};
      config.forEach((value, key) => { plainObj[key] = value; });
      return plainObj;
    }
    if (typeof config.toObject === 'function') return config.toObject();
    return config;
  }

  async executeAutomation(automationId: string, triggerData: any, externalContext?: any) {
    const automation = await Automation.findById(automationId).lean();
    if (!automation || !automation.isActive) throw new AppError(400, 'VALIDATION_ERROR', 'Automation inactive or missing');

    const organizationId = externalContext?.organizationId || triggerData?.organizationId || automation.organizationId?.toString();
    if (!organizationId) throw new Error('Missing organization context for execution');

    const userId = externalContext?.userId || (await this.resolveUserId(organizationId)) || '';
    const execution = await AutomationExecution.create({ automationId, status: 'pending', triggerData });

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Automation Engine] 🚀 STARTING AUTOMATION EXECUTION`);
    console.log(`[Automation Engine] Automation: ${automation.name}`);
    console.log(`[Automation Engine] Automation ID: ${automationId}`);
    console.log(`[Automation Engine] Execution ID: ${execution._id}`);
    console.log(`[Automation Engine] Organization: ${organizationId}`);
    console.log(`[Automation Engine] Trigger Data:`, JSON.stringify(triggerData, null, 2));
    console.log(`${'='.repeat(80)}\n`);

    try {
      const sortedNodes = [...automation.nodes].sort((a, b) => a.position - b.position);
      console.log(`[Automation Engine] 📋 Total nodes to process: ${sortedNodes.length}`);
      
      const triggerNode = sortedNodes.find(n => n.type === 'trigger');
      if (!triggerNode) throw new Error('No trigger node found');

      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) throw new Error(`Trigger handler missing: ${triggerNode.service}`);

      console.log(`[Automation Engine] ✅ Trigger validated: ${triggerNode.service}`);

      const triggerConfig = this.convertConfigToPlainObject(triggerNode.config);
      if (!(await triggerHandler.validate(triggerConfig, triggerData))) {
        console.log(`[Automation Engine] ❌ Trigger criteria not met`);
        execution.status = 'failed';
        execution.errorMessage = 'Trigger criteria not met';
        await execution.save();
        return;
      }

      const contactIds = Array.isArray(triggerData.contactIds) ? triggerData.contactIds : [triggerData.contactId].filter(Boolean);
      console.log(`[Automation Engine] 👥 Processing ${contactIds.length} contact(s)`);
      
      for (const contactId of contactIds) {
        let contact = await Customer.findById(contactId).lean();
        if (!contact) {
          console.log(`[Automation Engine] ⚠️  Contact ${contactId} not found, skipping`);
          continue;
        }

        // CRITICAL FIX: Use fresh contact data from CSV if available (for batch calls)
        // This ensures the LATEST email from CSV is used, not old database email
        if (triggerData.freshContactData) {
          console.log(`[Automation Engine] 🔄 Using fresh contact data from CSV instead of database`);
          console.log(`[Automation Engine] 📧 Database email: ${contact.email}`);
          console.log(`[Automation Engine] 📧 CSV email (fresh): ${triggerData.freshContactData.email}`);
          
          // Merge fresh data with database contact, prioritizing fresh data
          contact = {
            ...contact,
            name: triggerData.freshContactData.name || contact.name,
            email: triggerData.freshContactData.email || contact.email,
            phone: triggerData.freshContactData.phone || contact.phone
          };
          
          console.log(`[Automation Engine] ✅ Using merged contact data with fresh email: ${contact.email}`);
        }

        console.log(`\n[Automation Engine] 👤 Processing contact: ${contact.name} (${contact.email || 'no email'})`);

        const context: IAutomationExecutionContext = {
          contact,
          triggerData: { ...triggerData, contactId },
          organizationId,
          userId,
          now: new Date().toISOString(),
          appointment: triggerData.appointment
        };

        console.log(`[Automation Engine] 📦 Context prepared:`, {
          contactName: contact.name,
          contactEmail: contact.email,
          hasAppointment: !!context.appointment,
          appointmentBooked: context.appointment?.booked,
          usingFreshData: !!triggerData.freshContactData
        });

        let nodeIndex = 0;
        for (const node of sortedNodes) {
          nodeIndex++;
          if (node.type === 'trigger') {
            console.log(`[Automation Engine] [${nodeIndex}/${sortedNodes.length}] ⚡ Trigger: ${node.service}`);
            continue; // Skip trigger in main loop
          }

          console.log(`\n[Automation Engine] [${nodeIndex}/${sortedNodes.length}] 🔄 Executing: ${node.type} - ${node.service}`);

          const nodeConfig = this.convertConfigToPlainObject(node.config);
          
          if (node.type === 'delay') {
            console.log(`[Automation Engine] ⏱️  Delaying for ${nodeConfig.delay} ${nodeConfig.delayUnit}`);
            await this.delay(nodeConfig.delay, nodeConfig.delayUnit);
            console.log(`[Automation Engine] ✅ Delay completed`);
          } else if (node.type === 'condition') {
            // Evaluate condition
            const conditionMet = await this.evaluateCondition(nodeConfig, context);
            console.log(`[Automation Engine] 🔍 Condition evaluation: ${conditionMet ? '✅ PASS' : '❌ FAIL'}`, nodeConfig);
            
            if (!conditionMet) {
              console.log(`[Automation Engine] ⏭️  Condition not met, skipping remaining actions for this contact`);
              break; // Skip remaining nodes for this contact
            }
          } else if (node.type === 'action') {
            const runner = this.actions.get(node.service);
            if (!runner) {
              console.log(`[Automation Engine] ⚠️  No runner found for ${node.service}, skipping`);
              continue;
            }
            
            console.log(`[Automation Engine] 🎬 Executing action: ${node.service}`);
            const res = await runner.execute(nodeConfig, context.triggerData, context);
            
            if (res) {
              if (res.success === false) {
                console.log(`[Automation Engine] ❌ Action failed: ${node.service}`, res.error || res.reason);
                if (node.service !== 'keplero_google_sheet_append_row') {
                  throw new Error(res.error || `Action ${node.service} failed`);
                }
              } else if (res.status === 'skipped') {
                console.log(`[Automation Engine] ⏭️  Action skipped: ${node.service} - ${res.reason}`);
              } else if (res.status === 'completed' || res.success === true) {
                console.log(`[Automation Engine] ✅ Action completed: ${node.service}`);
                if (res.recipient) console.log(`[Automation Engine]    → Recipient: ${res.recipient}`);
              } else {
                console.log(`[Automation Engine] ✅ Action result:`, res);
              }
            } else {
              console.log(`[Automation Engine] ✅ Action completed: ${node.service} (no return value)`);
            }
          }
        }
      }
      
      execution.status = 'success';
      await execution.save();
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[Automation Engine] ✅ AUTOMATION EXECUTION COMPLETED SUCCESSFULLY`);
      console.log(`[Automation Engine] Execution ID: ${execution._id}`);
      console.log(`[Automation Engine] Status: ${execution.status}`);
      console.log(`${'='.repeat(80)}\n`);
      
    } catch (err: any) {
      execution.status = 'failed';
      execution.errorMessage = err.message;
      await execution.save();
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[Automation Engine] ❌ AUTOMATION EXECUTION FAILED`);
      console.log(`[Automation Engine] Execution ID: ${execution._id}`);
      console.log(`[Automation Engine] Error: ${err.message}`);
      console.log(`[Automation Engine] Stack:`, err.stack);
      console.log(`${'='.repeat(80)}\n`);
      
      throw err;
    }
  }

  async triggerByEvent(event: string, eventData: any, context?: any) {
    console.log(`\n${'━'.repeat(80)}`);
    console.log(`[Automation Engine] 🎯 EVENT TRIGGERED: ${event}`);
    console.log(`[Automation Engine] Event Data:`, JSON.stringify(eventData, null, 2));
    console.log(`${'━'.repeat(80)}\n`);

    const query: any = { isActive: true };
    const organizationId = context?.organizationId || eventData?.organizationId;
    if (organizationId) query.organizationId = organizationId;

    const automations = await Automation.find(query).lean();
    console.log(`[Automation Engine] 🔍 Found ${automations.length} active automation(s) to check`);

    const results: any[] = [];

    for (const automation of automations) {
      const triggerNode = automation.nodes.find(n => n.type === 'trigger');
      if (!triggerNode) {
        console.log(`[Automation Engine] ⚠️  No trigger node in automation: ${automation.name}`);
        continue;
      }
      
      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) {
        console.log(`[Automation Engine] ⚠️  No handler for trigger: ${triggerNode.service} in automation: ${automation.name}`);
        continue;
      }

      try {
        const triggerConfig = this.convertConfigToPlainObject(triggerNode.config);
        const isValid = await triggerHandler.validate(triggerConfig, eventData);
        
        if (isValid) {
          console.log(`[Automation Engine] ✅ Trigger matched for automation: ${automation.name}`);
          console.log(`[Automation Engine] 🚀 Starting async execution...`);
          
          const automationId = (automation._id as any).toString();
          this.executeAutomation(automationId, eventData, context).catch(err => {
            console.error(`[Automation Engine] ❌ Async failure for ${automation.name}:`, err.message);
          });
          results.push({ automationId, name: automation.name });
        } else {
          console.log(`[Automation Engine] ⏭️  Trigger not matched for automation: ${automation.name} (trigger: ${triggerNode.service})`);
        }
      } catch (error: any) {
        console.error(`[Automation Engine] ❌ Validation error:`, error.message);
      }
    }

    console.log(`\n[Automation Engine] 📊 Trigger Summary: ${results.length} automation(s) triggered`);
    if (results.length > 0) {
      results.forEach(r => console.log(`[Automation Engine]    ✅ ${r.name}`));
    }
    console.log(`${'━'.repeat(80)}\n`);

    return results;
  }

  private delay(amount: number, unit: string): Promise<void> {
    const multipliers: Record<string, number> = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000
    };
    return new Promise(resolve => setTimeout(resolve, amount * (multipliers[unit] || 1000)));
  }

  /**
   * Evaluate condition node
   * Supports checking nested properties like "appointment.booked"
   */
  private async evaluateCondition(config: any, context: IAutomationExecutionContext): Promise<boolean> {
    const { field, operator, value } = config;

    if (!field || !operator) {
      console.warn('[Automation Engine] ⚠️ Invalid condition config:', config);
      return false;
    }

    // Get actual value from context using dot notation
    let actualValue: any;
    const fieldParts = field.split('.');
    
    if (fieldParts.length === 2) {
      // Nested property like "appointment.booked"
      const [category, key] = fieldParts;
      const contextData: Record<string, any> = {
        contact: context.contact,
        appointment: context.appointment,
        conversation: context.conversation,
        ...context.triggerData
      };
      actualValue = contextData[category]?.[key];
    } else {
      // Flat property
      actualValue = (context as any)[field] || context.triggerData?.[field];
    }

    console.log(`[Automation Engine] 🔍 Condition check: ${field} ${operator} ${value} | Actual: ${actualValue}`);

    // Evaluate based on operator
    switch (operator) {
      case 'equals':
        return actualValue === value;
      case 'not_equals':
        return actualValue !== value;
      case 'contains':
        return String(actualValue || '').includes(String(value));
      case 'not_contains':
        return !String(actualValue || '').includes(String(value));
      case 'greater_than':
        return Number(actualValue) > Number(value);
      case 'less_than':
        return Number(actualValue) < Number(value);
      case 'is_true':
        return actualValue === true || actualValue === 'true';
      case 'is_false':
        return actualValue === false || actualValue === 'false';
      case 'exists':
        return actualValue !== null && actualValue !== undefined;
      case 'not_exists':
        return actualValue === null || actualValue === undefined;
      default:
        console.warn(`[Automation Engine] ⚠️ Unknown operator: ${operator}`);
        return false;
    }
  }

  async testAutomation(automationId: string, testData: any) {
    try {
      await this.executeAutomation(automationId, testData);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async performUnifiedOutboundCall(params: {
    contact: any;
    agent_id: string;
    phone_number_id: string;
    organizationId: string;
    userId?: string;
    campaignId?: string;
    dynamicVars?: Record<string, any>;
  }): Promise<any> {
    const { contact, agent_id, phone_number_id, organizationId, userId, dynamicVars } = params;
    const COMM_API = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

    // Check Credits (Gatekeeper)
    const hasCredit = await profileService.checkCredits(organizationId, 'voice', 1);
    if (!hasCredit) throw new AppError(403, 'LIMIT_REACHED', 'Voice minutes limit reached. Please upgrade your plan.');

    const normalizedPhone = normalizePhoneNumber(contact.phone);
    if (!normalizedPhone) throw new Error(`Invalid phone: ${contact.phone}`);

    const PhoneNumber = (await import('../models/PhoneNumber')).default;
    const Agent = (await import('../models/Agent')).default;

    const phoneNumberDoc = await PhoneNumber.findOne({
      $or: [{ phone_number_id }, { _id: mongoose.isValidObjectId(phone_number_id) ? phone_number_id : null }, { phone_number: phone_number_id }]
    }).lean();

    const agentDoc = await Agent.findOne({ agent_id }).lean();
    if (!agentDoc) throw new Error(`Agent not found: ${agent_id}`);

    const payload = {
      agent_id: agent_id,
      agent_phone_number_id: phoneNumberDoc?.elevenlabs_phone_number_id || phoneNumberDoc?.phone_number_id || phone_number_id,
      to_number: normalizedPhone,
      greeting_message: agentDoc.greeting_message || agentDoc.first_message,
      system_prompt: agentDoc.system_prompt,
      voice_id: agentDoc.voice_id || VOICE_ID_MAP['adam'],
      language: agentDoc.language || 'en',
      customer_info: { name: contact.name, email: contact.email, phone_number: normalizedPhone },
      dynamic_variables: { customer_name: contact.name, ...dynamicVars }
    };

    const response = await axios.post(`${COMM_API}/api/v1/phone-numbers/twilio/outbound-call`, payload, { timeout: 20000 });
    if (response.data?.status === 'error') throw new Error(response.data.message);

    const Conversation = (await import('../models/Conversation')).default;
    const conversationId = response.data.conversation_id || response.data.id;
    
    // CRITICAL: Create conversation with callerId for transcript polling
    await Conversation.create({
      customerId: contact._id || contact.id,
      channel: 'phone',
      status: 'open',
      organizationId,
      metadata: { 
        external_call_id: conversationId,
        conversation_id: conversationId,
        callerId: conversationId, // CRITICAL: For transcript polling
        phone_number: normalizedPhone, 
        agent_id,
        source: 'automation_outbound'
      }
    });

    // Use credits
    await profileService.useCredits(organizationId, 'voice', 1);

    return response.data;
  }
}

export const automationEngine = new AutomationEngine();

