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
import { googleGmailService } from './googleGmail.service';
import GoogleIntegration from '../models/GoogleIntegration';

const COMM_API = process.env.COMM_API_URL || 'https://keplerov1-python-2.onrender.com';

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
 * Ensures phone number starts with + prefix
 */
const normalizePhoneNumber = (phone: string): string => {
  if (!phone) return phone;
  
  // Remove any whitespace
  phone = phone.trim();
  
  // If already has +, return as is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Add + prefix
  return '+' + phone;
};

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

    // Mass Sending (Campaign) Trigger
    this.triggers.set('keplero_mass_sending', {
      validate: async (config, data) => {
        // This trigger fires when mass sending is initiated
        // Either from CSV import or list selection
        return data.event === 'mass_sending' && 
               (data.source === 'csv' || data.source === 'list');
      }
    });

    // Legacy triggers (keep for backward compatibility)
    this.triggers.set('facebook_lead', {
      validate: async (config, data) => {
        return data.pageId === config.pageId && data.formId === config.formId;
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
            }).catch(() => {});
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
        const contactId = triggerData.contactId || config.contactId;
        
        if (!contactId) {
          throw new Error('Contact ID is required for outbound call');
        }

        // Get contact details
        const contact = await Customer.findById(contactId);
        if (!contact || !contact.phone) {
          throw new Error('Contact not found or phone number missing');
        }

        // Get phone settings - find any configured settings if userId not provided
        let phoneSettings;
        if (context?.userId) {
          phoneSettings = await PhoneSettings.findOne({ userId: context.userId });
        } else {
          // Find the first configured phone settings
          phoneSettings = await PhoneSettings.findOne({ isConfigured: true });
        }
        
        if (!phoneSettings || !phoneSettings.isConfigured) {
          throw new Error('Phone settings not configured. Please configure phone settings in the Settings page.');
        }

        // Map selectedVoice name to ElevenLabs voice ID
        // Use customVoiceId if provided, otherwise use the mapped voice ID
        const voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
        
        // Get API keys for LLM
        let provider = 'openai';
        let apiKey = '';
        let apiKeysConfigured = false;
        try {
          const { apiKeysService } = await import('./apiKeys.service');
          const apiKeys = await apiKeysService.getApiKeys(String(context?.userId || phoneSettings.userId));
          provider = apiKeys.llmProvider;
          apiKey = apiKeys.apiKey;
          apiKeysConfigured = true;
        } catch (error: any) {
          console.warn('[Automation] Failed to fetch API keys:', error.message);
          console.warn('[Automation] ⚠️  API keys not configured. Calls may fail. Please configure API keys in Settings → API Keys');
        }
        
        // Get voice agent prompt and language from AI Behavior settings
        let voiceAgentPrompt = config.dynamicInstruction || '';
        let voiceLanguage = config.language || 'en';
        
        // If no dynamic instruction in config, fetch from AI Behavior
        if (!voiceAgentPrompt && context?.userId) {
          try {
            const { aiBehaviorService } = await import('./aiBehavior.service');
            const aiBehavior = await aiBehaviorService.get(context.userId);
            voiceAgentPrompt = aiBehavior.voiceAgent.systemPrompt || 'You are a helpful AI voice assistant.';
            voiceLanguage = aiBehavior.voiceAgent.language || 'en';
            console.log('[Automation] Using voice agent prompt from AI Behavior settings');
          } catch (error: any) {
            console.warn('[Automation] Failed to fetch voice agent prompt:', error.message);
            voiceAgentPrompt = 'Have a friendly conversation';
          }
        }
        
        // Normalize phone number to E.164 format
        const normalizedPhone = normalizePhoneNumber(contact.phone);
        
        // Get default knowledge bases from settings
        let collectionNames: string[] = [];
        if (context?.userId) {
          try {
            const Settings = (await import('../models/Settings')).default;
            const settings = await Settings.findOne({ userId: context.userId });
            if (settings) {
              // Prefer multiple knowledge bases (new format)
              if (settings.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
                collectionNames = settings.defaultKnowledgeBaseNames;
              } 
              // Fallback to single knowledge base (legacy format)
              else if (settings.defaultKnowledgeBaseName) {
                collectionNames = [settings.defaultKnowledgeBaseName];
              }
            }
            console.log(`[Automation] Using ${collectionNames.length} knowledge base(s):`, collectionNames);
          } catch (error: any) {
            console.warn(`[Automation] Could not fetch knowledge bases:`, error.message);
          }
        }
        
        // Prepare call request
        const callRequestBody: any = {
          phone_number: normalizedPhone,
          name: contact.name || 'Customer',
          dynamic_instruction: voiceAgentPrompt,
          language: voiceLanguage,
          voice_id: voiceId,
          sip_trunk_id: phoneSettings.livekitSipTrunkId,
          provider: provider,
          api_key: apiKey,
          collection_names: collectionNames, // Updated to support multiple collections
          greeting_message: phoneSettings.greetingMessage || 'Hello! How can I help you today?' // Greeting message from settings
        };
        
        console.log('📝 [Automation] Using greeting message:', callRequestBody.greeting_message);

        // Add optional fields
        if (config.transferTo || phoneSettings.humanOperatorPhone) {
          callRequestBody.transfer_to = config.transferTo || phoneSettings.humanOperatorPhone;
        }

        // Get e-commerce credentials if available
        if (context?.userId) {
          try {
            const { getEcommerceCredentials } = await import('../utils/ecommerce.util');
            const ecommerceCredentials = await getEcommerceCredentials(context.userId);
            if (ecommerceCredentials) {
              callRequestBody.ecommerce_credentials = ecommerceCredentials;
            }
          } catch (error: any) {
            console.warn('[Automation] Could not fetch e-commerce credentials:', error.message);
          }
        }
        
        // Get escalation conditions from AIBehavior if not set
        if (!config.escalationCondition && context?.userId) {
          try {
            const { aiBehaviorService } = await import('./aiBehavior.service');
            const aiBehavior = await aiBehaviorService.get(context.userId);
            const escalationRules = aiBehavior.voiceAgent.humanOperator?.escalationRules || [];
            if (escalationRules.length > 0) {
              callRequestBody.escalation_condition = escalationRules.join('. ');
            }
          } catch (error: any) {
            console.warn('[Automation] Could not fetch escalation conditions:', error.message);
          }
        } else if (config.escalationCondition) {
          callRequestBody.escalation_condition = config.escalationCondition;
        }

        const callUrl = `${COMM_API}/calls/outbound`;

        try {
          console.log(`\n========== AUTOMATION - OUTBOUND CALL ==========`);
          console.log(`📞 [Automation] URL: ${callUrl}`);
          console.log(`📦 [Automation] Full Request Body:`, JSON.stringify({
            ...callRequestBody,
            api_key: callRequestBody.api_key ? `${callRequestBody.api_key.substring(0, 10)}...***` : '❌ NOT_SET'
          }, null, 2));
          console.log(`=====================================================\n`);
          
          if (!apiKeysConfigured || !callRequestBody.api_key) {
            console.error(`[Automation] ❌ CRITICAL: API Key is missing! Call will likely fail.`);
            console.error(`[Automation] Please configure your API keys at Settings → API Keys`);
          }
          
          const callResponse = await axios.post(callUrl, callRequestBody, {
            timeout: 360000,
          });

          console.log(`\n========== AUTOMATION - CALL RESPONSE ==========`);
          console.log(`✅ [Automation] Response Status: ${callResponse.status}`);
          console.log(`📦 [Automation] Full Response Body:`, JSON.stringify(callResponse.data, null, 2));
          console.log(`=====================================================\n`);

          // Create conversation immediately after successful call
          if (callResponse.data.status === 'success' && callResponse.data.details?.caller_id && context.userId) {
            try {
              const { conversationService } = await import('./conversation.service');
              const User = (await import('../models/User')).default;
              const user = await User.findById(context.userId);
              const conversation = await conversationService.createForOutboundCall({
                userId: context.userId,
                organizationId: user?.organizationId?.toString() || context.userId,
                phone: contact.phone,
                name: contact.name || 'Unknown',
                callerId: callResponse.data.details.caller_id
              });
              console.log(`[Automation] Created conversation ${conversation._id} for ${contact.name}`);
            } catch (convError: any) {
              console.error(`[Automation] Failed to create conversation:`, convError.message);
            }
          }

          // Track voice usage if call was successful
          if (callResponse.data.status === 'success' && context.userId) {
            const duration = callResponse.data.duration || 0; // Duration in seconds
            const durationMinutes = Math.ceil(duration / 60); // Convert to minutes, round up
            await trackUsage(context.userId, 'voice', durationMinutes);
            console.log(`[Automation] Tracked ${durationMinutes} voice minutes for user ${context.userId}`);
          }

          return {
            success: true,
            status: callResponse.data.status,
            transcript: callResponse.data.transcript || null,
            contactId: contact._id,
            phone: contact.phone
          };
        } catch (error: any) {
          console.error(`[Automation] Outbound call error:`, {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            code: error.code
          });
          
          return {
            success: false,
            error: error.response?.data?.message || error.message || 'Call failed',
            errorDetails: error.code === 'ECONNREFUSED' ? 'Python backend not reachable' : error.message,
            contactId: contact._id,
            phone: contact.phone
          };
        }
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

        // TODO: Implement actual SMS sending via Twilio or similar service
        // For now, return success placeholder
        return {
          success: true,
          contactId: contact._id,
          phone: contact.phone,
          message,
          sentAt: new Date()
        };
      }
    });

    // Email Sending Action
    this.actions.set('keplero_send_email', {
      execute: async (config, triggerData, context) => {
        const contactId = triggerData.contactId || config.contactId;
        const { subject, body, template, is_html, to } = config;

        // Resolve recipient email - support dynamic variables
        let recipientEmail: string | null = null;

        // If 'to' is provided in config, use it (may contain variables)
        if (to) {
          // Simple variable replacement: {{contact.email}}, {{contact.name}}, etc.
          let resolvedTo = to;
          if (contactId) {
            const contact = await Customer.findById(contactId);
            if (contact) {
              resolvedTo = resolvedTo
                .replace(/\{\{contact\.email\}\}/g, contact.email || '')
                .replace(/\{\{contact\.name\}\}/g, contact.name || '')
                .replace(/\{\{contact\.phone\}\}/g, contact.phone || '');
            }
          }
          // Replace {{now}} with current date/time
          resolvedTo = resolvedTo.replace(/\{\{now\}\}/g, new Date().toISOString());
          
          if (resolvedTo.trim()) {
            recipientEmail = resolvedTo.trim();
          }
        }

        // Fallback to contact email if 'to' not provided or resolved to empty
        if (!recipientEmail && contactId) {
          const contact = await Customer.findById(contactId);
          if (!contact) {
            throw new Error('Contact not found');
          }
          if (!contact.email) {
            throw new Error('Contact email missing. Please provide email address in "to" field or ensure contact has email.');
          }
          recipientEmail = contact.email;
        }

        if (!recipientEmail || recipientEmail.trim() === '') {
          throw new Error('Email action not configured correctly. Recipient email is required.');
        }

        // Validate subject and body
        const emailSubject = subject || 'Notification';
        const emailBody = body || template || '';

        if (!emailSubject.trim()) {
          throw new Error('Email action not configured correctly. Subject is required.');
        }

        if (!emailBody.trim()) {
          throw new Error('Email action not configured correctly. Body is required.');
        }

        // Debug logging
        console.log('[Automation] Email action payload:', {
          to: recipientEmail,
          subject: emailSubject,
          bodyLength: emailBody.length,
          isHtml: is_html || false,
          contactId: contactId?.toString(),
          organizationId: context?.organizationId?.toString(),
          userId: context?.userId?.toString()
        });

        // Use external API for email sending (same as campaign service)
        try {
          console.log(`[Automation] Sending email to ${recipientEmail}...`);
          const emailResponse = await axios.post(`${COMM_API}/email/send`, {
            receiver_email: recipientEmail,
            subject: emailSubject,
            body: emailBody,
            is_html: is_html || false,
          }, {
            timeout: 30000, // 30 seconds timeout
          });

          const success = emailResponse.data.status === 'success';
          console.log(`[Automation] Email to ${recipientEmail} ${success ? 'sent successfully' : 'failed'}`);

          return {
            success,
            contactId: contactId?.toString(),
            email: recipientEmail,
            subject: emailSubject,
            messageId: emailResponse.data.messageId,
            sentAt: new Date()
          };
        } catch (error: any) {
          console.error(`[Automation] Email to ${recipientEmail} failed:`, {
            error: error.response?.data?.detail || error.message,
            statusCode: error.response?.status,
            recipientEmail
          });
          throw new Error(`Email sending failed: ${error.response?.data?.detail || error.message}`);
        }
      }
    });

    // WhatsApp Template Action
    this.actions.set('send_whatsapp', {
      execute: async (config, triggerData) => {
        const { templateId, delay, delayUnit } = config;
        const contactId = triggerData.contactId;

        if (delay && delay > 0) {
          await this.delay(delay, delayUnit);
        }

        const contact = await Customer.findById(contactId);
        if (!contact || !contact.phone) {
          throw new Error('Contact not found or phone missing');
        }

        const result = await this.whatsappService.sendTemplate(
          contact.phone,
          templateId,
          'en',
          config.variables || {}
        );

        return result;
      }
    });

    // Legacy actions
    this.actions.set('send_email', {
      execute: async (config, triggerData) => {
        return { sent: true, email: triggerData.email };
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
        }).catch(() => {});
        return { added: true, listId: config.listId };
      }
    });

    // ============ GOOGLE WORKSPACE ACTIONS (ADDITIVE ONLY) ============
    
    // Google Calendar - Check Availability
    this.actions.set('keplero_google_calendar_check_availability', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;
        
        // Resolve userId if missing
        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }
        
        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Google Calendar actions');
        }

        // Check if Google Calendar is connected
        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.calendar': true
        });

        if (!integration) {
          throw new Error('Google Calendar integration not connected. Please connect Google Workspace in Settings.');
        }

        const { timeMin, timeMax, calendarIds } = config;
        if (!timeMin || !timeMax) {
          throw new Error('timeMin and timeMax are required for availability check');
        }

        try {
          const availability = await googleCalendarService.checkAvailability(
            userId.toString(),
            organizationId.toString(),
            new Date(timeMin),
            new Date(timeMax),
            calendarIds || ['primary']
          );

          return {
            success: true,
            availability,
            checkedAt: new Date()
          };
        } catch (error: any) {
          console.error('[Automation] Google Calendar availability check failed:', error);
          throw new Error(`Google Calendar availability check failed: ${error.message}`);
        }
      }
    });

    // Google Calendar - Create Event
    this.actions.set('keplero_google_calendar_create_event', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;
        
        // Resolve userId if missing
        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }
        
        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Google Calendar actions');
        }

        // Check if Google Calendar is connected
        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.calendar': true
        });

        if (!integration) {
          throw new Error('Google Calendar integration not connected. Please connect Google Workspace in Settings.');
        }

        const { summary, description, startDateTime, endDateTime, timeZone, attendees, location } = config;
        
        if (!summary || !startDateTime || !endDateTime) {
          throw new Error('summary, startDateTime, and endDateTime are required for calendar event');
        }

        try {
          const event = await googleCalendarService.createEvent(
            userId.toString(),
            organizationId.toString(),
            {
              summary,
              description,
              start: {
                dateTime: startDateTime,
                timeZone: timeZone || 'UTC'
              },
              end: {
                dateTime: endDateTime,
                timeZone: timeZone || 'UTC'
              },
              attendees: attendees || [],
              location
            },
            config.calendarId || 'primary'
          );

          return {
            success: true,
            eventId: event.eventId,
            htmlLink: event.htmlLink,
            hangoutLink: event.hangoutLink,
            createdAt: new Date()
          };
        } catch (error: any) {
          console.error('[Automation] Google Calendar event creation failed:', error);
          throw new Error(`Google Calendar event creation failed: ${error.message}`);
        }
      }
    });

    // Google Sheets - Append Row
    this.actions.set('keplero_google_sheet_append_row', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;
        
        // Resolve userId if missing
        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }
        
        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Google Sheets actions');
        }

        // STRICT VALIDATION: Check config before attempting API call
        const { spreadsheetId, range, sheetName, values } = config;
        
        // Debug log for troubleshooting
        console.log('[Automation] Google Sheets config:', {
          spreadsheetId: spreadsheetId || 'MISSING',
          valuesLength: values?.length || 0,
          hasSpreadsheetId: !!spreadsheetId,
          hasValues: !!(values && Array.isArray(values) && values.length > 0),
          range,
          sheetName,
          organizationId: organizationId?.toString(),
          userId: userId?.toString()
        });

        // Validate required fields
        if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
          throw new Error('Google Sheet action not configured. Please select a spreadsheet and map fields.');
        }

        if (!values || !Array.isArray(values) || values.length === 0) {
          throw new Error('Google Sheet action not configured. Please select a spreadsheet and map fields.');
        }

        // Check if Google Sheets is connected
        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.sheets': true
        });

        if (!integration) {
          throw new Error('Google Sheets integration not connected. Please connect Google Workspace in Settings.');
        }

        try {
          const google = require('googleapis').google;
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/integrations/google/callback'
          );

          oauth2Client.setCredentials({
            access_token: integration.accessToken,
            refresh_token: integration.refreshToken
          });

          const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

          // Build range for append operation
          // Google Sheets append API REQUIRES: column range format like "Sheet1!A:Z"
          // NOT "Sheet1" (invalid), NOT "Sheet1!A1" (single cell), NOT "Sheet1!A:A" (single column)
          // ✅ CORRECT: "Sheet1!A:Z" - defines columns A through Z, Google finds next empty row
          
          // Determine sheet name: prefer from range, then from sheetName config, then default
          let sheet: string;
          
          if (range && range.includes('!')) {
            // Extract sheet name from range (e.g., "Sheet1" from "Sheet1!A1")
            const parts = range.split('!');
            sheet = parts[0];
          } else {
            // Use sheetName from config or default
            sheet = sheetName || 'Sheet1';
          }
          
          // ✅ ALWAYS use column range format: Sheet1!A:Z
          // This is the industry standard (Zapier, Make, n8n all use A:Z)
          // Google Sheets append API will find the next empty row automatically
          const appendRange = `${sheet}!A:Z`;

          console.log('[Automation] Appending to Google Sheet:', {
            spreadsheetId: spreadsheetId.substring(0, 20) + '...',
            range: appendRange,
            sheetName: sheetName || 'Sheet1',
            valuesCount: values.length,
            valuesPreview: values.slice(0, 3)
          });

          const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: appendRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [values]
            }
          });

          console.log('[Automation] ✅ Google Sheets append successful:', {
            updatedRange: response.data.updates?.updatedRange,
            updatedRows: response.data.updates?.updatedRows
          });

          return {
            success: true,
            updatedRange: response.data.updates?.updatedRange,
            updatedRows: response.data.updates?.updatedRows || 1,
            appendedAt: new Date()
          };
        } catch (error: any) {
          console.error('[Automation] Google Sheets append failed:', {
            error: error.message,
            spreadsheetId: spreadsheetId?.substring(0, 20),
            valuesCount: values?.length
          });
          throw new Error(`Google Sheets append failed: ${error.message}`);
        }
      }
    });

    // Google Gmail - Send Email
    this.actions.set('keplero_google_gmail_send', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;
        
        // Resolve userId if missing
        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }
        
        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Gmail actions');
        }

        // Check if Gmail is connected
        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.gmail': true
        });

        if (!integration) {
          throw new Error('Google Gmail integration not connected. Please connect Google Workspace in Settings.');
        }

        const contactId = triggerData.contactId || config.contactId;
        const { to, subject, body, isHtml, cc, bcc, replyTo } = config;

        // Get recipient email
        let recipientEmail = to;
        if (!recipientEmail && contactId) {
          const contact = await Customer.findById(contactId);
          if (!contact || !contact.email) {
            throw new Error('Contact not found or email missing');
          }
          recipientEmail = contact.email;
        }

        if (!recipientEmail) {
          throw new Error('Recipient email is required');
        }

        if (!subject || !body) {
          throw new Error('Subject and body are required for Gmail');
        }

        try {
          const result = await googleGmailService.sendEmail(
            userId.toString(),
            organizationId.toString(),
            {
              to: recipientEmail,
              subject,
              body,
              isHtml: isHtml || false,
              cc,
              bcc,
              replyTo
            }
          );

          console.log(`[Automation] Gmail sent to ${recipientEmail} successfully`);

          return {
            success: true,
            messageId: result.messageId,
            threadId: result.threadId,
            to: recipientEmail,
            subject,
            sentAt: new Date()
          };
        } catch (error: any) {
          console.error(`[Automation] Gmail send to ${recipientEmail} failed:`, error);
          throw new Error(`Gmail send failed: ${error.message}`);
        }
      }
    });
  }

  /**
   * Resolve userId from organizationId if not provided in context
   * Google integrations are user-scoped, so we need the organization owner's userId
   */
  private async resolveUserId(organizationId: any, context?: any): Promise<string | null> {
    // If userId is already in context, use it
    if (context?.userId) {
      return context.userId.toString();
    }

    // If automation has userId, use it
    if (context?.automation?.userId) {
      return context.automation.userId.toString();
    }

    // Resolve from organization ownerId
    if (organizationId) {
      try {
        const org = await Organization.findById(organizationId);
        if (org?.ownerId) {
          return org.ownerId.toString();
        }
      } catch (error) {
        console.error('[Automation Engine] Error resolving userId from organization:', error);
      }
    }

    return null;
  }

  /**
   * Convert Mongoose Map to plain object
   * CRITICAL: Mongoose stores config as Map, but we need plain object for execution
   */
  private convertConfigToPlainObject(config: any): Record<string, any> {
    if (!config) return {};
    
    // If it's already a plain object, return as is
    if (config.constructor === Object) {
      return config;
    }
    
    // If it's a Mongoose Map, convert to plain object
    if (config instanceof Map) {
      const plainObj: Record<string, any> = {};
      config.forEach((value, key) => {
        plainObj[key] = value;
      });
      return plainObj;
    }
    
    // Try to convert using Object.fromEntries if available
    if (typeof config.toObject === 'function') {
      return config.toObject();
    }
    
    // Fallback: return as is
    return config;
  }

  async executeAutomation(automationId: string, triggerData: any, context?: any) {
    // CRITICAL: Always fetch fresh from database (no cache)
    // Use lean() to get plain JavaScript objects, not Mongoose documents
    const automation = await Automation.findById(automationId).lean();

    if (!automation || !automation.isActive) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Automation not found or inactive');
    }

    // Resolve organizationId and userId
    const organizationId = context?.organizationId || triggerData?.organizationId || automation.organizationId;
    
    // Resolve userId if missing (needed for Google integrations)
    let userId = context?.userId;
    if (!userId && organizationId) {
      // Need to fetch automation document for resolveUserId if needed
      const automationDoc = await Automation.findById(automationId);
      userId = await this.resolveUserId(organizationId, { ...context, automation: automationDoc });
    }

    // Update context with resolved values
    const enrichedContext = {
      ...context,
      organizationId: organizationId?.toString(),
      userId: userId?.toString(),
      automation
    };

    console.log(`[Automation Engine] Executing automation: ${automation.name} (${automationId})`, {
      organizationId: enrichedContext.organizationId,
      userId: enrichedContext.userId,
      nodeCount: automation.nodes.length
    });

    const execution = await AutomationExecution.create({
      automationId,
      status: 'pending',
      triggerData
    });

    try {
      // Sort nodes by position
      const sortedNodes = [...automation.nodes].sort((a, b) => a.position - b.position);

      // Get trigger node
      const triggerNode = sortedNodes.find(n => n.type === 'trigger');
      if (!triggerNode) {
        throw new Error('No trigger node found');
      }

      // CRITICAL: Convert trigger config from Map to plain object
      const triggerConfig = this.convertConfigToPlainObject(triggerNode.config);
      
      // Validate trigger
      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) {
        throw new Error(`Trigger handler not found: ${triggerNode.service}`);
      }

      const isValid = await triggerHandler.validate(triggerConfig, triggerData);
      if (!isValid) {
        execution.status = 'failed';
        execution.errorMessage = 'Trigger validation failed';
        await execution.save();
        return;
      }

      const actionResults: any[] = [];

      // Execute delay nodes and action nodes in sequence
      for (const node of sortedNodes) {
        // CRITICAL: Convert node.config from Map to plain object BEFORE using it
        const nodeConfig = this.convertConfigToPlainObject(node.config);
        
        // Log config for debugging (especially for Google Sheets)
        if (node.service === 'keplero_google_sheet_append_row') {
          console.log(`[Automation Engine] 📋 Node config for ${node.service} (${node.id}):`, {
            spreadsheetId: nodeConfig.spreadsheetId || 'MISSING',
            sheetName: nodeConfig.sheetName,
            valuesLength: nodeConfig.values?.length || 0,
            values: nodeConfig.values,
            configKeys: Object.keys(nodeConfig),
            configType: typeof nodeConfig,
            isMap: nodeConfig instanceof Map,
            isPlainObject: nodeConfig.constructor === Object
          });
        }
        
        if (node.type === 'delay') {
          await this.delay(nodeConfig.delay, nodeConfig.delayUnit);
        } else if (node.type === 'action') {
          const actionHandler = this.actions.get(node.service);
          if (!actionHandler) {
            throw new Error(`Action handler not found: ${node.service}`);
          }

          console.log(`[Automation Engine] Executing action: ${node.service} (nodeId: ${node.id})`);
          try {
            // CRITICAL: Pass converted plain object config, not Mongoose Map
            const actionResult = await actionHandler.execute(nodeConfig, triggerData, enrichedContext);
            console.log(`[Automation Engine] ✅ Action ${node.service} completed:`, {
              success: actionResult?.success !== false,
              result: actionResult
            });
            actionResults.push({
              nodeId: node.id,
              service: node.service,
              result: actionResult
            });
          } catch (actionError: any) {
            console.error(`[Automation Engine] ❌ Action ${node.service} failed:`, actionError.message);
            // Continue with other actions even if one fails
            actionResults.push({
              nodeId: node.id,
              service: node.service,
              result: {
                success: false,
                error: actionError.message
              }
            });
          }
        }
      }

      // Update execution as success
      execution.status = 'success';
      execution.actionData = actionResults;
      await execution.save();

      // Update automation stats (fetch fresh document for update)
      await Automation.findByIdAndUpdate(automationId, {
        $inc: { executionCount: 1 },
        lastExecutedAt: new Date()
      });

      return {
        success: true,
        executionId: execution._id,
        results: actionResults
      };

    } catch (error: any) {
      execution.status = 'failed';
      execution.errorMessage = error.message;
      await execution.save();
      throw error;
    }
  }

  // Method to trigger automation based on event
  async triggerByEvent(event: string, eventData: any, context?: any) {
    // Build query to find active automations
    const query: any = { isActive: true };
    
    // Filter by organizationId if provided in context or eventData
    const organizationId = context?.organizationId || eventData?.organizationId;
    if (organizationId) {
      query.organizationId = organizationId;
    }
    
    console.log(`[Automation Engine] Triggering event: ${event}`, {
      organizationId,
      hasContext: !!context,
      eventDataKeys: Object.keys(eventData || {})
    });
    
    // CRITICAL: Always fetch fresh from database (no cache)
    // Use lean() to get plain JavaScript objects, not Mongoose documents
    const automations = await Automation.find(query).lean();
    
    console.log(`[Automation Engine] Found ${automations.length} active automation(s) for organization ${organizationId}`);

    const results = [];

    for (const automation of automations) {
      const triggerNode = automation.nodes.find(n => n.type === 'trigger');
      
      if (!triggerNode) continue;

      // CRITICAL: Convert trigger config from Map to plain object
      const triggerConfig = this.convertConfigToPlainObject(triggerNode.config);

      // Check if trigger matches the event
      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) continue;

      try {
        const isValid = await triggerHandler.validate(triggerConfig, eventData);
        
        if (isValid) {
          const automationId = (automation._id as any).toString();
          console.log(`[Automation Engine] ✅ Trigger matched for automation: ${automation.name} (${automationId})`);
          
          // Execute automation asynchronously
          this.executeAutomation(automationId, eventData, context)
            .then(result => {
              console.log(`[Automation Engine] ✅ Automation ${automation.name} executed successfully`);
            })
            .catch(err => {
              console.error(`[Automation Engine] ❌ Error executing automation ${automationId}:`, err.message);
            });
          
          results.push({
            automationId: automation._id,
            name: automation.name,
            triggered: true
          });
        } else {
          console.log(`[Automation Engine] ⏭️  Trigger validation failed for automation: ${automation.name}`);
        }
      } catch (error: any) {
        console.error(`[Automation Engine] ❌ Error validating trigger for automation ${automation._id}:`, error.message);
      }
    }

    return results;
  }

  private delay(amount: number, unit: string): Promise<void> {
    const multipliers: Record<string, number> = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000
    };

    const ms = amount * (multipliers[unit] || 1000);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testAutomation(automationId: string, testData: any) {
    const automation = await Automation.findById(automationId);

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    try {
      await this.executeAutomation(automationId, testData);
      return {
        testId: 'test_' + Date.now(),
        status: 'success',
        result: {
          triggered: true,
          actionExecuted: true,
          message: 'Test completed successfully'
        }
      };
    } catch (error: any) {
      return {
        testId: 'test_' + Date.now(),
        status: 'failed',
        result: {
          triggered: false,
          actionExecuted: false,
          message: error.message
        }
      };
    }
  }
}

export const automationEngine = new AutomationEngine();

