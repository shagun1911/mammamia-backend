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

// Use PYTHON_API_URL if available (for elvenlabs-voiceagent), otherwise fall back to COMM_API_URL
const COMM_API = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

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
        const contactId = triggerData.contactId || config.contactId;

        if (!contactId) {
          throw new Error('Contact ID is required for outbound call');
        }

        // Get contact details
        const contact = await Customer.findById(contactId);
        if (!contact || !contact.phone) {
          throw new Error('Contact not found or phone number missing');
        }

        const organizationId = context?.organizationId || triggerData?.organizationId || (contact as any).organizationId;
        const normalizedPhone = normalizePhoneNumber(contact.phone);

        // New path: use agent_id + phone_number_id (same as test call / batch call) – no phone settings required
        if (config.agent_id && config.phone_number_id && organizationId) {
          const PhoneNumber = (await import('../models/PhoneNumber')).default;
          const phoneNumber = await PhoneNumber.findOne({
            phone_number_id: config.phone_number_id,
            organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString())
          }).lean();

          if (!phoneNumber) {
            throw new Error('Selected phone number not found. Please choose a valid phone number in the automation action.');
          }
          if (!phoneNumber.supports_outbound) {
            throw new Error('Selected phone number does not support outbound calls. Please choose an outbound-capable number.');
          }

          let elevenlabsId = phoneNumber.elevenlabs_phone_number_id;
          if (!elevenlabsId && (phoneNumber.provider === 'twilio' && phoneNumber.sid && phoneNumber.token)) {
            const { sipTrunkService } = await import('./sipTrunk.service');
            const reg = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
              label: phoneNumber.label,
              phone_number: phoneNumber.phone_number,
              sid: phoneNumber.sid,
              token: phoneNumber.token,
              supports_inbound: phoneNumber.supports_inbound || false,
              supports_outbound: phoneNumber.supports_outbound || false
            });
            elevenlabsId = reg.phone_number_id;
            await PhoneNumber.updateOne(
              { phone_number_id: config.phone_number_id },
              { $set: { elevenlabs_phone_number_id: elevenlabsId } }
            );
          } else if (!elevenlabsId && (phoneNumber.provider === 'sip_trunk' || phoneNumber.provider === 'sip') && phoneNumber.outbound_trunk_config) {
            const { sipTrunkService } = await import('./sipTrunk.service');
            const reg = await sipTrunkService.registerSipPhoneNumberWithElevenLabs({
              label: phoneNumber.label,
              phone_number: phoneNumber.phone_number,
              provider: (phoneNumber.provider as 'sip_trunk' | 'sip') || 'sip_trunk',
              supports_inbound: phoneNumber.supports_inbound || false,
              supports_outbound: phoneNumber.supports_outbound || false,
              inbound_trunk_config: phoneNumber.inbound_trunk_config,
              outbound_trunk_config: phoneNumber.outbound_trunk_config
            });
            elevenlabsId = reg.phone_number_id;
            await PhoneNumber.updateOne(
              { phone_number_id: config.phone_number_id },
              { $set: { elevenlabs_phone_number_id: elevenlabsId } }
            );
          }
          if (!elevenlabsId) {
            throw new Error('Selected phone number is not registered with the voice service. Please register it in Configuration → Phone and try again.');
          }

          const { sipTrunkService } = await import('./sipTrunk.service');
          const customerInfo = { name: contact.name || 'Customer', ...(contact.email && { email: contact.email }) };
          
          // Resolve sender_email using priority order
          let sender_email: string | undefined;
          
          if (context?.userId) {
            try {
              const userId = context.userId.toString();
              const userObjectId = new mongoose.Types.ObjectId(userId);
              
              // Priority 1: Connected Gmail integration
              const googleIntegration = await GoogleIntegration.findOne({
                userId: userObjectId,
                'services.gmail': true,
                status: 'active'
              }).lean();
              
              if (googleIntegration?.googleProfile?.email) {
                sender_email = googleIntegration.googleProfile.email;
              } else {
                // Try SocialIntegration as fallback
                const SocialIntegration = (await import('../models/SocialIntegration')).default;
                const socialIntegration = await SocialIntegration.findOne({
                  userId: userObjectId,
                  platform: 'gmail',
                  status: 'connected'
                }).lean();
                
                if (socialIntegration) {
                  sender_email = socialIntegration.credentials?.email || socialIntegration.metadata?.email;
                }
              }
              
              // Priority 2: Default SMTP sender
              if (!sender_email) {
                sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
              }
            } catch (emailError: any) {
              console.warn('[Automation Engine] ⚠️ Error resolving sender email:', emailError.message);
              // Fallback to DEFAULT_SMTP_SENDER_EMAIL on error
              if (!sender_email) {
                sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
              }
            }
          } else {
            // No userId, try DEFAULT_SMTP_SENDER_EMAIL
            sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
          }
          
          // Log resolved sender email
          console.log('[Outbound Call] sender_email resolved:', sender_email ?? 'python-fallback');
          
          if (phoneNumber.provider === 'twilio') {
            await sipTrunkService.twilioOutboundCall({
              agent_id: config.agent_id,
              agent_phone_number_id: elevenlabsId,
              to_number: normalizedPhone,
              customer_info: customerInfo,
              sender_email
            });
          } else {
            await sipTrunkService.outboundCall({
              agent_id: config.agent_id,
              agent_phone_number_id: elevenlabsId,
              to_number: normalizedPhone,
              customer_info: customerInfo,
              sender_email
            });
          }

          if (context?.userId) {
            try {
              const { trackUsage } = await import('../middleware/profileTracking.middleware');
              await trackUsage(context.userId, 'voice', 1);
            } catch (_) {}
          }
          return { success: true, contactId: contact._id, phone: contact.phone };
        }

        // Legacy path: require phone settings
        let phoneSettings;
        if (context?.userId) {
          phoneSettings = await PhoneSettings.findOne({ userId: context.userId });
        } else {
          phoneSettings = await PhoneSettings.findOne({ isConfigured: true });
        }

        if (!phoneSettings || !phoneSettings.isConfigured) {
          throw new Error('Phone settings not configured, or select Agent and Phone number in the automation action (recommended).');
        }

        // 🔑 CRITICAL: Determine which outbound number to use
        // Priority: config.outboundNumber > phoneSettings.twilioPhoneNumber > first available outbound config
        let outboundNumber = config.outboundNumber || phoneSettings.twilioPhoneNumber;
        
        // If no outbound number specified, get the first available from OutboundAgentConfig
        if (!outboundNumber && context?.userId) {
          try {
            const { outboundAgentConfigService } = await import('./outboundAgentConfig.service');
            const allConfigs = await outboundAgentConfigService.getAll(String(context.userId));
            if (allConfigs && allConfigs.length > 0) {
              outboundNumber = allConfigs[0].outboundNumber;
              console.log(`[Automation] No outbound number specified, using first available: ${outboundNumber}`);
            }
          } catch (error: any) {
            console.warn(`[Automation] Could not fetch outbound configs:`, error.message);
          }
        }

        if (!outboundNumber) {
          throw new Error('No outbound phone number configured. Please configure an outbound number in Phone Settings.');
        }

        // 🔑 CRITICAL: Fetch per-number config from OutboundAgentConfig (NOT global phoneSettings)
        let voiceId = VOICE_ID_MAP['adam']; // Default fallback
        let transferTo = '';
        let greetingMessage = 'Hello! How can I help you today?';
        let escalationRules: string[] = [];

        if (context?.userId) {
          try {
            const { outboundAgentConfigService } = await import('./outboundAgentConfig.service');
            const outboundConfig = await outboundAgentConfigService.getByOutboundNumber(String(context.userId), outboundNumber);
            
            if (outboundConfig) {
              // Use per-number config (THIS IS THE FIX)
              voiceId = outboundConfig.customVoiceId || VOICE_ID_MAP[outboundConfig.selectedVoice] || VOICE_ID_MAP['adam'];
              transferTo = outboundConfig.humanOperatorPhone || '';
              greetingMessage = outboundConfig.greetingMessage || 'Hello! How can I help you today?';
              escalationRules = outboundConfig.escalationRules || [];
              console.log(`[Automation] ✅ Using per-number config for ${outboundNumber}: voice=${voiceId}, language=${outboundConfig.language || 'en'}`);
            } else {
              // Fallback to global phoneSettings if no per-number config exists
              console.warn(`[Automation] ⚠️ No per-number config found for ${outboundNumber}, falling back to global settings`);
              voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
              transferTo = phoneSettings.humanOperatorPhone || '';
              greetingMessage = phoneSettings.greetingMessage || 'Hello! How can I help you today?';
            }
          } catch (error: any) {
            console.error(`[Automation] ❌ Failed to fetch outbound config for ${outboundNumber}:`, error.message);
            // Fallback to global settings
            voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
            transferTo = phoneSettings.humanOperatorPhone || '';
            greetingMessage = phoneSettings.greetingMessage || 'Hello! How can I help you today?';
          }
        } else {
          // No userId, use global settings
          voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
          transferTo = phoneSettings.humanOperatorPhone || '';
          greetingMessage = phoneSettings.greetingMessage || 'Hello! How can I help you today?';
        }

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
          console.warn('[Automation] ⚠️  Platform API keys not configured. Calls may fail. Please configure platform API keys in environment variables.');
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
            // Use language from per-number config if available, otherwise from AI Behavior
            if (context?.userId) {
              try {
                const { outboundAgentConfigService } = await import('./outboundAgentConfig.service');
                const outboundConfig = await outboundAgentConfigService.getByOutboundNumber(String(context.userId), outboundNumber);
                if (outboundConfig?.language) {
                  voiceLanguage = outboundConfig.language;
                } else {
                  voiceLanguage = aiBehavior.voiceAgent.language || 'en';
                }
              } catch (error: any) {
                voiceLanguage = aiBehavior.voiceAgent.language || 'en';
              }
            } else {
              voiceLanguage = aiBehavior.voiceAgent.language || 'en';
            }
            console.log('[Automation] Using voice agent prompt from AI Behavior settings');
          } catch (error: any) {
            console.warn('[Automation] Failed to fetch voice agent prompt:', error.message);
            voiceAgentPrompt = 'Have a friendly conversation';
          }
        }

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

        // 🔑 CRITICAL: Render greeting message with contact data before sending to Python API
        // This replaces {{name}}, {{email}}, {{phone}} with actual contact values
        let renderedGreetingMessage = greetingMessage || 'Hello! How can I help you today?';
        if (greetingMessage && (greetingMessage.includes('{{name}}') || greetingMessage.includes('{{email}}') || greetingMessage.includes('{{phone}}'))) {
          try {
            const { renderGreeting, getDefaultGreeting } = await import('../utils/greetingRenderer');
            
            // Prepare contact data from automation contact
            const contactName = contact.name?.trim() || 'there';
            const contactData = {
              name: contactName,
              email: contact.email?.trim() || '',
              phone: normalizedPhone || ''
            };
            
            // Render the greeting template with contact data
            const renderingResult = renderGreeting(greetingMessage, contactData, contactName);
            
            if (renderingResult.success) {
              renderedGreetingMessage = renderingResult.rendered;
              console.log(`[Automation] ✅ Greeting rendered: "${greetingMessage}" -> "${renderedGreetingMessage}"`);
              if (renderingResult.warnings.length > 0) {
                console.warn(`[Automation] ⚠️ Rendering warnings:`, renderingResult.warnings);
              }
            } else {
              console.error(`[Automation] ❌ Failed to render greeting:`, renderingResult.errors);
              // Use fallback greeting if rendering fails
              renderedGreetingMessage = getDefaultGreeting(voiceLanguage || 'en');
              console.warn(`[Automation] ⚠️ Using fallback greeting due to rendering failure`);
            }
          } catch (error: any) {
            console.error(`[Automation] ❌ Error rendering greeting:`, error.message);
            // Use fallback greeting if rendering throws an error
            const { getDefaultGreeting } = await import('../utils/greetingRenderer');
            renderedGreetingMessage = getDefaultGreeting(voiceLanguage || 'en');
            console.warn(`[Automation] ⚠️ Using fallback greeting due to error`);
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
          greeting_message: renderedGreetingMessage // Use rendered greeting message (variables replaced)
        };

        console.log('📝 [Automation] Using greeting message:', callRequestBody.greeting_message);
        console.log('📝 [Automation] Using outbound number:', outboundNumber);

        // Add optional fields
        if (transferTo) {
          callRequestBody.transfer_to = transferTo;
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

        // Get escalation conditions from per-number config or AIBehavior
        if (escalationRules.length > 0) {
          callRequestBody.escalation_condition = escalationRules.join('. ');
        } else if (!config.escalationCondition && context?.userId) {
          try {
            const { aiBehaviorService } = await import('./aiBehavior.service');
            const aiBehavior = await aiBehaviorService.get(context.userId);
            const aiEscalationRules = aiBehavior.voiceAgent.humanOperator?.escalationRules || [];
            if (aiEscalationRules.length > 0) {
              callRequestBody.escalation_condition = aiEscalationRules.join('. ');
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
            console.error(`[Automation] Platform API keys not configured. Please configure platform API keys in environment variables.`);
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

        try {
          // Normalize phone number to E.164 format
          const normalizedPhone = normalizePhoneNumber(contact.phone);

          console.log(`[Automation Engine] Sending SMS to ${normalizedPhone}...`);
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

        // Validate and resolve subject and body
        const rawSubject = subject || 'Notification';
        const rawBody = body || template || '';

        if (!rawSubject.trim()) {
          throw new Error('Email action not configured correctly. Subject is required.');
        }

        if (!rawBody.trim()) {
          throw new Error('Email action not configured correctly. Body is required.');
        }

        // ✅ RESOLVE DYNAMIC VARIABLES (CRITICAL FIX)
        const contact = contactId ? await Customer.findById(contactId).lean() : null;
        const emailSubject = await this.resolveDynamicVariables(rawSubject, triggerData, contact);
        const emailBody = await this.resolveDynamicVariables(rawBody, triggerData, contact);

        // Debug logging
        console.log('[Automation] Aistein Email (SMTP) action payload:', {
          to: recipientEmail,
          subject: emailSubject,
          bodyLength: emailBody.length,
          isHtml: is_html || false,
          contactId: contactId?.toString(),
          organizationId: context?.organizationId?.toString(),
          userId: context?.userId?.toString()
        });

        // Use local EmailService with SMTP credentials from .env
        try {
          console.log(`[Automation] Sending Aistein Email (SMTP) to ${recipientEmail}...`);

          // Use EMAIL_FROM from env if available, otherwise use default from EmailService
          const fromEmail = process.env.EMAIL_FROM || undefined;

          const emailResult = await emailService.sendEmail({
            to: recipientEmail,
            subject: emailSubject,
            ...(is_html ? { html: emailBody } : { text: emailBody }),
            from: fromEmail
          });

          if (!emailResult.success) {
            const errorMessage = emailResult.error || 'SMTP Email sending failed';
            console.error(`[Automation] SMTP Email to ${recipientEmail} failed:`, errorMessage);
            throw new Error(`Aistein Email sending failed: ${errorMessage}`);
          }

          console.log(`[Automation] Aistein Email (SMTP) to ${recipientEmail} sent successfully (Message ID: ${emailResult.messageId})`);

          return {
            success: true,
            to: recipientEmail,
            subject: emailSubject,
            messageId: emailResult.messageId,
            sentAt: new Date(),
            path: 'local_smtp'
          };
        } catch (error: any) {
          console.error(`[Automation] SMTP Email to ${recipientEmail} failed:`, error.message);
          throw error;
        }
      }
    });

    // WhatsApp Template Action
    this.actions.set('send_whatsapp', {
      execute: async (config, triggerData, context) => {
        const { templateName, templateId, phoneNumberId, to, delay, delayUnit, languageCode = 'en_US', components = [] } = config;
        const contactId = triggerData.contactId;

        if (delay && delay > 0) {
          await this.delay(delay, delayUnit);
        }

        // Resolve phoneNumberId from integration if not provided
        let resolvedPhoneNumberId = phoneNumberId;
        let userAccessToken: string | null = null;

        if (!resolvedPhoneNumberId) {
          const organizationId = context?.organizationId || triggerData?.organizationId;
          if (organizationId) {
            const SocialIntegration = (await import('../models/SocialIntegration')).default;
            const integration = await SocialIntegration.findOne({
              organizationId,
              platform: 'whatsapp',
              status: 'connected'
            });

            if (integration?.credentials?.phoneNumberId) {
              resolvedPhoneNumberId = integration.credentials.phoneNumberId;
              userAccessToken = integration.credentials.apiKey; // USER access token
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

        // Use templateName or templateId (templateName takes precedence)
        // Default to "hello_world" if not specified (for testing)
        const resolvedTemplateName = templateName || templateId || 'hello_world';
        const resolvedLanguageCode = languageCode || 'en_US';

        if (!resolvedTemplateName || resolvedTemplateName.trim() === '') {
          throw new Error('templateName is required.');
        }

        // Construct Graph API URL exactly as specified
        const graphApiUrl = `https://graph.facebook.com/v18.0/${resolvedPhoneNumberId}/messages`;

        // Build payload exactly as specified (do NOT include components unless required)
        const payload: any = {
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'template',
          template: {
            name: resolvedTemplateName,
            language: { code: resolvedLanguageCode }
          }
        };

        // Only include components if explicitly provided and not empty
        if (components && Array.isArray(components) && components.length > 0) {
          payload.template.components = components;
        }

        console.log('[Automation] WhatsApp Template - Final URL and payload:', {
          url: graphApiUrl,
          phoneNumberId: resolvedPhoneNumberId,
          to: recipientPhone,
          templateName: resolvedTemplateName,
          languageCode: resolvedLanguageCode,
          hasComponents: components && components.length > 0,
          payload: JSON.stringify(payload, null, 2)
        });

        // Use WhatsAppService.sendTemplateMessage with proper parameters
        const result = await this.whatsappService.sendTemplateMessage(userAccessToken, {
          phoneNumberId: resolvedPhoneNumberId,
          to: recipientPhone,
          templateName: resolvedTemplateName,
          languageCode: resolvedLanguageCode,
          components: components && components.length > 0 ? components : []
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

    // Google Calendar - Check Availability
    this.actions.set('keplero_google_calendar_check_availability', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;

        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }

        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Calendar actions');
        }

        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.calendar': true
        });

        if (!integration) {
          throw new Error('Google Calendar integration not connected');
        }

        const { timeMin, timeMax } = config;

        try {
          const availability = await googleCalendarService.checkAvailability(
            userId.toString(),
            organizationId.toString(),
            new Date(timeMin || Date.now()),
            new Date(timeMax || (Date.now() + 24 * 60 * 60 * 1000))
          );

          return {
            success: true,
            availability
          };
        } catch (error: any) {
          console.error('[Automation] Google Calendar availability check failed:', error.message);
          throw new Error(`Calendar check failed: ${error.message}`);
        }
      }
    });

    // Google Calendar - Create Event
    this.actions.set('keplero_google_calendar_create_event', {
      execute: async (config, triggerData, context) => {
        const organizationId = context?.organizationId || triggerData?.organizationId;
        let userId = context?.userId;

        if (!userId && organizationId) {
          userId = await this.resolveUserId(organizationId, context);
        }

        if (!organizationId || !userId) {
          throw new Error('Organization ID and User ID are required for Calendar actions');
        }

        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.calendar': true
        });

        if (!integration) {
          throw new Error('Google Calendar integration not connected');
        }

        const { summary, description, startTime, endTime, attendees } = config;

        try {
          const event = await googleCalendarService.createEvent(
            userId.toString(),
            organizationId.toString(),
            {
              summary: await this.resolveDynamicVariables(summary, triggerData),
              description: await this.resolveDynamicVariables(description, triggerData),
              start: {
                dateTime: startTime || new Date().toISOString()
              },
              end: {
                dateTime: endTime || new Date(Date.now() + 60 * 60 * 1000).toISOString()
              },
              attendees: attendees || []
            }
          );

          return {
            success: true,
            event
          };
        } catch (error: any) {
          console.error('[Automation] Google Calendar event creation failed:', error.message);
          throw new Error(`Calendar event creation failed: ${error.message}`);
        }
      }
    });

    // Google Sheets - Append Row (FINAL FIXED)
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

        const { spreadsheetId, values } = config;

        if (!spreadsheetId || !Array.isArray(values) || values.length === 0) {
          throw new Error('Google Sheet action not configured properly');
        }

        // Check integration
        const integration = await GoogleIntegration.findOne({
          userId,
          organizationId,
          status: 'active',
          'services.sheets': true
        });

        if (!integration) {
          throw new Error('Google Sheets integration not connected');
        }

        try {
          const { google } = require('googleapis');

          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI ||
              'http://localhost:5001/api/v1/integrations/google/callback'
          );

          oauth2Client.setCredentials({
            access_token: integration.accessToken,
            refresh_token: integration.refreshToken
          });

          const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

          // ✅ AUTO-DETECT SHEET NAME (CRITICAL FIX)
          const sheetMeta = await sheets.spreadsheets.get({
            spreadsheetId
          });

          const sheetName =
            sheetMeta.data.sheets?.[0]?.properties?.title;

          if (!sheetName) {
            throw new Error('No sheet found in spreadsheet');
          }

          // ✅ CORRECT RANGE (THIS IS THE KEY)
          const range = `${sheetName}!A1`;

          // Resolve contact variables
          let contact: any = null;
          if (triggerData.contactId) {
            contact = await Customer.findById(triggerData.contactId).lean();
          }

          const resolvedValues = values.map((value: any) => {
            if (typeof value !== 'string') return value;

            if (contact) {
              return value
                .replace(/\{\{contact\.name\}\}/g, contact.name || '')
                .replace(/\{\{contact\.email\}\}/g, contact.email || '')
                .replace(/\{\{contact\.phone\}\}/g, contact.phone || '')
                .replace(
                  /\{\{contact\.createdAt\}\}/g,
                  contact.createdAt
                    ? new Date(contact.createdAt).toISOString()
                    : ''
                );
            }

            return value;
          });

          console.log('[Automation] Google Sheets append:', {
            spreadsheetId,
            range,
            values: resolvedValues
          });

          const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range, // ✅ MUST BE SheetName!A1
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
              values: [resolvedValues] // 2D array REQUIRED
            }
          });

          console.log('[Automation] ✅ Google Sheets append success');

          return {
            success: true,
            updatedRange: response.data.updates?.updatedRange,
            updatedRows: response.data.updates?.updatedRows || 1,
            appendedAt: new Date()
          };
        } catch (error: any) {
          console.error('[Automation] Google Sheets append failed:', error.message);

          return {
            success: false,
            error: `Google Sheets append failed: ${error.message}`,
            appendedAt: new Date()
          };
        }
      }
    });


    // Google Gmail - Send Email (FIXED - Using Social Integration)
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

        // ✅ CHECK SOCIAL INTEGRATION (CRITICAL FIX)
        const integration = await SocialIntegration.findOne({
          userId,
          organizationId,
          platform: 'gmail',
          status: 'connected'
        });

        if (!integration) {
          throw new Error('Gmail not connected. Please connect Gmail in Social Integrations (Settings > Socials).');
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
          // Resolve dynamic variables in body and subject
          const contact = contactId ? await Customer.findById(contactId).lean() : null;
          const resolvedSubject = await this.resolveDynamicVariables(subject, triggerData, contact);
          const resolvedBody = await this.resolveDynamicVariables(body, triggerData, contact);

          console.log(`[Automation] Gmail – Send Email: Using Gmail OAuth for ${recipientEmail} (Account: ${integration.getDecryptedApiKey()})`);

          const userEmail = integration.getDecryptedApiKey();

          // FORCED GMAIL PATH - uses gmailOAuthService directly, no SMTP fallback
          const result = await gmailOAuthService.sendEmail(userEmail, {
            to: recipientEmail,
            subject: resolvedSubject,
            body: resolvedBody,
            cc,
            bcc
          });

          console.log(`[Automation] ✅ Gmail – Send Email: Successfully sent to ${recipientEmail} via OAuth`);

          return {
            success: true,
            messageId: result.messageId || 'sent',
            to: recipientEmail,
            subject: resolvedSubject,
            sentAt: new Date(),
            path: 'gmail_oauth'
          };
        } catch (error: any) {
          console.error(`[Automation] Gmail – Send Email failed for ${recipientEmail}:`, error);
          throw new Error(`Gmail OAuth send failed: ${error.message}`);
        }
      }
    });
  }

  /**
   * Extract sheet name from range for Google Sheets append operations
   * Google Sheets append API REQUIRES A1 notation (e.g., "Sheet1!A1")
   * This function extracts the sheet name from any range format
   */
  private extractSheetNameFromRange(range: string): string {
    if (!range || typeof range !== 'string') {
      return 'Sheet1'; // Default sheet name
    }

    // If range is already just a sheet name (no !), return as-is
    if (!range.includes('!')) {
      return range.trim();
    }

    // Extract sheet name from formats like "Sheet1!A1", "Sheet1!A:D", "Sheet1!A:A"
    const match = range.match(/^(.+?)!/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Fallback: return default if extraction fails
    return 'Sheet1';
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
      const contactIds = Array.isArray(triggerData.contactIds) ? triggerData.contactIds : [triggerData.contactId].filter(Boolean);

      if (contactIds.length === 0) {
        throw new Error('No contacts found for automation execution');
      }

      console.log(`[Automation Engine] 🚀 Running workflow for ${contactIds.length} contact(s)`);

      // Execute and resolve for each contact
      // We do this sequentially to follow the user's "Errors isolated per contact" and "Automation = once" flow
      for (const contactId of contactIds) {
        const contactResults = [];
        console.log(`[Automation Engine] 👤 Processing contact: ${contactId}`);

        // Fetch contact for this iteration
        const contact = await Customer.findById(contactId).lean();

        // Create a copy of triggerData with specific contactId for this iteration
        const currentTriggerData = { ...triggerData, contactId, contactIds: undefined };

        try {
          // Execute delay nodes and action nodes in sequence for this contact
          for (const node of sortedNodes) {
            const nodeConfig = this.convertConfigToPlainObject(node.config);

            if (node.type === 'delay') {
              console.log(`[Automation Engine] ⏱️  Delaying ${nodeConfig.delay} ${nodeConfig.delayUnit} for contact ${contactId}`);
              await this.delay(nodeConfig.delay, nodeConfig.delayUnit);
            } else if (node.type === 'action') {
              const actionHandler = this.actions.get(node.service);
              if (!actionHandler) {
                console.error(`[Automation Engine] ❌ Action handler not found: ${node.service}`);
                continue;
              }

              console.log(`[Automation Engine] ⚡ Executing action: ${node.service} for contact ${contactId}`);
              let actionSucceeded = true;
              try {
                const actionResult = await actionHandler.execute(nodeConfig, currentTriggerData, { ...enrichedContext, contact });

                if (actionResult && actionResult.success === false) {
                  const errorMessage = actionResult.error || 'Action failed';
                  console.error(`[Automation Engine] ❌ Action ${node.service} failed for contact ${contactId}:`, errorMessage);
                  actionSucceeded = false;

                  contactResults.push({
                    nodeId: node.id,
                    service: node.service,
                    result: { success: false, error: errorMessage }
                  });

                  // Google Sheets failures should NOT stop workflow, but mark as failed
                  if (node.service !== 'keplero_google_sheet_append_row') {
                    throw new Error(errorMessage);
                  }
                } else {
                  contactResults.push({
                    nodeId: node.id,
                    service: node.service,
                    result: actionResult || { success: true }
                  });
                }
              } catch (actionError: any) {
                console.error(`[Automation Engine] ❌ Exception in action ${node.service} for contact ${contactId}:`, actionError.message);
                actionSucceeded = false;
                contactResults.push({
                  nodeId: node.id,
                  service: node.service,
                  result: { success: false, error: actionError.message }
                });

                if (node.service !== 'keplero_google_sheet_append_row') {
                  throw actionError; // Stop node sequence for THIS contact
                }
              }
              
              // Track if any action failed for this contact
              if (!actionSucceeded && node.service === 'keplero_google_sheet_append_row') {
                // Mark that Google Sheets failed (but don't stop workflow)
                contactResults.push({ _hasFailedAction: true });
              }
            }
          }

          // Check if any action failed (including Google Sheets)
          const hasFailedActions = contactResults.some((r: any) => 
            r.result && r.result.success === false
          );
          
          // Mark contact status based on whether any action failed
          const contactStatus = hasFailedActions ? 'failed' : 'success';
          actionResults.push({ 
            contactId, 
            status: contactStatus, 
            nodes: contactResults,
            ...(hasFailedActions ? { 
              error: contactResults.find((r: any) => r.result?.success === false)?.result?.error || 'One or more actions failed'
            } : {})
          });
        } catch (contactError: any) {
          console.error(`[Automation Engine] ❌ Workflow stopped for contact ${contactId}:`, contactError.message);
          actionResults.push({ contactId, status: 'failed', error: contactError.message, nodes: contactResults });
          // We continue to the NEXT contact even if one fails
        }
      }

      // Check if ALL contacts succeeded (not just ANY)
      const allSucceeded = actionResults.every(r => r.status === 'success');
      const anySuccess = actionResults.some(r => r.status === 'success');
      
      // Execution status: failed if ANY action failed, success only if ALL succeeded
      execution.status = allSucceeded ? 'success' : 'failed';
      execution.actionData = actionResults;
      if (!allSucceeded) {
        const failedContacts = actionResults.filter(r => r.status === 'failed');
        const failedActions = actionResults
          .flatMap(r => r.nodes || [])
          .filter((n: any) => n.result?.success === false);
        execution.errorMessage = failedContacts.length > 0 
          ? `${failedContacts.length} contact(s) failed: ${failedContacts.map(c => c.error || 'Unknown error').join('; ')}`
          : failedActions.length > 0
          ? `${failedActions.length} action(s) failed: ${failedActions.map((a: any) => a.result?.error || 'Unknown error').join('; ')}`
          : 'One or more actions failed';
      }
      await execution.save();

      // Update automation stats
      await Automation.findByIdAndUpdate(automationId, {
        $inc: { executionCount: contactIds.length },
        lastExecutedAt: new Date()
      });

      return {
        success: anySuccess,
        executionId: execution._id,
        results: actionResults
      };

    } catch (error: any) {
      execution.status = 'failed';
      execution.errorMessage = error.message;
      await execution.save();

      console.error(`[Automation Engine] ❌ Automation execution failed:`, error.message);

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

          // Handle batch_call by passing the entire eventData to executeAutomation
          // which now handles the loop internally for cleaner tracking (Automation = once)
          if (event === 'batch_call' && Array.isArray(eventData.contactIds)) {
            console.log(`[Automation Engine] 📦 Triggering batch execution for ${eventData.contactIds.length} contacts`);
            this.executeAutomation(automationId, eventData, context)
              .catch(err => {
                console.error(`[Automation Engine] ❌ Error in batch execution for automation ${automationId}:`, err.message);
              });
          } else {
            // Standard single execution
            this.executeAutomation(automationId, eventData, context)
              .then(result => {
                if (result && result.success) {
                  console.log(`[Automation Engine] ✅ Automation ${automation.name} executed successfully`);
                } else {
                  console.error(`[Automation Engine] ❌ Automation ${automation.name} execution failed:`, (result as any)?.error || 'Unknown error');
                }
              })
              .catch(err => {
                console.error(`[Automation Engine] ❌ Error executing automation ${automationId}:`, err.message);
              });
          }

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

  /**
   * Resolve dynamic variables in text using trigger data
   */
  private async resolveDynamicVariables(text: string, triggerData: any, contact?: any): Promise<string> {
    if (!text || typeof text !== 'string') return text;

    let resolvedText = text;

    // Resolve contact variables if contactId is present
    let contactToUse = contact;
    const contactId = triggerData?.contactId || triggerData?.customer?._id || triggerData?.id;

    if (!contactToUse && contactId && text.includes('{{contact.')) {
      try {
        contactToUse = await Customer.findById(contactId);
      } catch (err) {
        console.error('[Automation Engine] Error resolving contact variables:', err);
      }
    }

    if (contactToUse) {
      resolvedText = resolvedText
        .replace(/\{\{contact\.email\}\}/g, contactToUse.email || '')
        .replace(/\{\{contact\.name\}\}/g, contactToUse.name || '')
        .replace(/\{\{contact\.phone\}\}/g, contactToUse.phone || '')
        .replace(/\{\{contact\.createdAt\}\}/g, contactToUse.createdAt ? new Date(contactToUse.createdAt).toISOString() : '');
    }

    // Resolve general triggerData variables
    if (triggerData) {
      // Basic flat property resolution
      Object.keys(triggerData).forEach(key => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        if (resolvedText.includes(`{{${key}}}`)) {
          const val = triggerData[key];
          resolvedText = resolvedText.replace(regex, typeof val === 'object' ? JSON.stringify(val) : String(val));
        }
      });
    }

    // Resolve common variables
    resolvedText = resolvedText.replace(/\{\{now\}\}/g, new Date().toISOString());

    return resolvedText;
  }
}

export const automationEngine = new AutomationEngine();

