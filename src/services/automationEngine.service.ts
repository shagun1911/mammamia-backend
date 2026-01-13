import Automation from '../models/Automation';
import AutomationExecution from '../models/AutomationExecution';
import Customer from '../models/Customer';
import ContactListMember from '../models/ContactListMember';
import Campaign from '../models/Campaign';
import PhoneSettings from '../models/PhoneSettings';
import { WhatsAppService } from './whatsapp.service';
import { AppError } from '../middleware/error.middleware';
import axios from 'axios';
import { trackUsage } from '../middleware/profileTracking.middleware';
import { profileService } from './profile.service';

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
        const { subject, body, template, is_html } = config;

        if (!contactId) {
          throw new Error('Contact ID is required for email');
        }

        const contact = await Customer.findById(contactId);
        if (!contact || !contact.email) {
          throw new Error('Contact not found or email missing');
        }

        // Use external API for email sending (same as campaign service)
        try {
          console.log(`[Automation] Sending email to ${contact.email}...`);
          const emailResponse = await axios.post(`${COMM_API}/email/send`, {
            receiver_email: contact.email,
            subject: subject || 'Notification',
            body: body || template || '',
            is_html: is_html || false,
          }, {
            timeout: 30000, // 30 seconds timeout
          });

          const success = emailResponse.data.status === 'success';
          console.log(`[Automation] Email to ${contact.email} ${success ? 'sent successfully' : 'failed'}`);

          return {
            success,
            contactId: contact._id,
            email: contact.email,
            subject: subject || 'Notification',
            messageId: emailResponse.data.messageId,
            sentAt: new Date()
          };
        } catch (error: any) {
          console.error(`[Automation] Email to ${contact.email} failed:`, error.response?.data?.detail || error.message);
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
  }

  async executeAutomation(automationId: string, triggerData: any, context?: any) {
    const automation = await Automation.findById(automationId);

    if (!automation || !automation.isActive) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Automation not found or inactive');
    }

    console.log(`[Automation Engine] Executing automation: ${automation.name} (${automationId})`, {
      organizationId: context?.organizationId || automation.organizationId,
      nodeCount: automation.nodes.length
    });

    const execution = await AutomationExecution.create({
      automationId,
      status: 'pending',
      triggerData
    });

    try {
      // Sort nodes by position
      const sortedNodes = automation.nodes.sort((a, b) => a.position - b.position);

      // Get trigger node
      const triggerNode = sortedNodes.find(n => n.type === 'trigger');
      if (!triggerNode) {
        throw new Error('No trigger node found');
      }

      // Validate trigger
      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) {
        throw new Error(`Trigger handler not found: ${triggerNode.service}`);
      }

      const isValid = await triggerHandler.validate(triggerNode.config, triggerData);
      if (!isValid) {
        execution.status = 'failed';
        execution.errorMessage = 'Trigger validation failed';
        await execution.save();
        return;
      }

      const actionResults: any[] = [];

      // Execute delay nodes and action nodes in sequence
      for (const node of sortedNodes) {
        if (node.type === 'delay') {
          await this.delay(node.config.delay, node.config.delayUnit);
        } else if (node.type === 'action') {
          const actionHandler = this.actions.get(node.service);
          if (!actionHandler) {
            throw new Error(`Action handler not found: ${node.service}`);
          }

          console.log(`[Automation Engine] Executing action: ${node.service} (nodeId: ${node.id})`);
          try {
            const actionResult = await actionHandler.execute(node.config, triggerData, context);
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

      // Update automation stats
      automation.executionCount += 1;
      automation.lastExecutedAt = new Date();
      await automation.save();

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
    
    // Find all active automations matching the organization
    const automations = await Automation.find(query);
    
    console.log(`[Automation Engine] Found ${automations.length} active automation(s) for organization ${organizationId}`);

    const results = [];

    for (const automation of automations) {
      const triggerNode = automation.nodes.find(n => n.type === 'trigger');
      
      if (!triggerNode) continue;

      // Check if trigger matches the event
      const triggerHandler = this.triggers.get(triggerNode.service);
      if (!triggerHandler) continue;

      try {
        const isValid = await triggerHandler.validate(triggerNode.config, eventData);
        
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

