import InboundAgentConfig, { IInboundAgentConfig } from '../models/InboundAgentConfig';
import PhoneSettings from '../models/PhoneSettings';
import AIBehavior from '../models/AIBehavior';
import Settings from '../models/Settings';
import { AppError } from '../middleware/error.middleware';
import { getEcommerceCredentials } from '../utils/ecommerce.util';
import mongoose from 'mongoose';

export class InboundAgentConfigService {
  /**
   * Get all inbound agent configs for a user
   */
  async get(userId: string) {
    const configs = await InboundAgentConfig.find({ userId }).sort({ calledNumber: 1 });
    return configs;
  }

  /**
   * Get single inbound agent config by phone number
   * If phone number has an agent_id assigned, use that agent's configuration
   * Otherwise, fall back to InboundAgentConfig
   */
  async getByPhoneNumber(userId: string, calledNumber: string) {
    // First, check if phone number has an agent assigned
    const PhoneNumber = (await import('../models/PhoneNumber')).default;
    const Agent = (await import('../models/Agent')).default;
    const User = (await import('../models/User')).default;
    const mongoose = (await import('mongoose')).default;
    
    const userObjectId = (userId as any) instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId.toString());
    
    // Get user's organizationId for proper phone number lookup
    const user = await User.findById(userObjectId).lean();
    const organizationId = (user as any)?.organizationId || userObjectId;
    const orgObjectId = organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString());
    
    // Find phone number by phone_number (not phone_number_id)
    // Check both organizationId (primary) and userId (backward compatibility)
    const phoneNumber = await PhoneNumber.findOne({
      phone_number: calledNumber,
      $or: [
        { organizationId: orgObjectId },
        { userId: userObjectId }
      ]
    });

    // If phone number has agent_id assigned, use that agent
    if (phoneNumber?.agent_id) {
      console.log(
        '[Inbound Call] Phone number',
        calledNumber,
        'routed to agent',
        phoneNumber.agent_id
      );

      const agent = await Agent.findOne({
        agent_id: phoneNumber.agent_id,
        userId: userObjectId
      });

      if (!agent) {
        console.error(
          '[Inbound Call] ❌ Agent',
          phoneNumber.agent_id,
          'not found for phone number',
          calledNumber
        );
        throw new AppError(
          404,
          'AGENT_NOT_FOUND',
          `Agent ${phoneNumber.agent_id} assigned to phone number ${calledNumber} not found. Please reassign a valid agent.`
        );
      }

      // Get e-commerce credentials if available
      const ecommerceCredentials = await getEcommerceCredentials(userId);

      // Build config from agent
      const config: any = {
        userId: userObjectId,
        calledNumber: calledNumber,
        voice_id: agent.voice_id || '21m00Tcm4TlvDq8ikWAM',
        language: agent.language || 'en',
        agent_instruction: agent.system_prompt || '',
        greeting_message: agent.greeting_message || agent.first_message || 'Hello! How can I help you today?',
        knowledge_base_ids: agent.knowledge_base_ids || [],
        collections: [], // Legacy field
        ecommerce_credentials: ecommerceCredentials || undefined
      };

      console.log('[Inbound Call] ✅ Using agent configuration:', {
        agent_id: agent.agent_id,
        agent_name: agent.name,
        voice_id: config.voice_id,
        language: config.language
      });

      return config;
    }

    // Fall back to InboundAgentConfig if no agent assigned
    const config = await InboundAgentConfig.findOne({ userId, calledNumber });
    return config;
  }

  /**
   * Sync inbound agent configs by gathering data from various settings
   * Creates one document for each inbound phone number
   */
  async syncConfig(userId: string) {
    console.log('[InboundAgentConfig Service] ==========================================');
    console.log('[InboundAgentConfig Service] SYNC CONFIG CALLED');
    console.log('[InboundAgentConfig Service] UserId:', userId);
    console.log('[InboundAgentConfig Service] ==========================================');

    // Add small delay to ensure DB has committed the changes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Fetch all required settings
    const [phoneSettings, aiBehavior, settings] = await Promise.all([
      PhoneSettings.findOne({ userId }),
      AIBehavior.findOne({ userId }),
      Settings.findOne({ userId })
    ]);

    console.log('[InboundAgentConfig Service] Fetched settings:', {
      hasPhoneSettings: !!phoneSettings,
      hasAIBehavior: !!aiBehavior,
      hasSettings: !!settings,
      inboundPhoneNumbers: phoneSettings?.inboundPhoneNumbers || [],
      numberOfInboundNumbers: (phoneSettings?.inboundPhoneNumbers || []).length
    });

    console.log('[InboundAgentConfig Service] Full phoneSettings:', {
      userId: phoneSettings?.userId,
      inboundPhoneNumbers: phoneSettings?.inboundPhoneNumbers,
      inboundTrunkId: phoneSettings?.inboundTrunkId,
      inboundTrunkName: phoneSettings?.inboundTrunkName
    });

    // Determine voice_id (prefer customVoiceId if set, otherwise use selectedVoice)
    const voice_id = phoneSettings?.customVoiceId || phoneSettings?.selectedVoice || 'adam';

    // Get knowledge_base_ids from settings (for voice agents - these are document_ids)
    const knowledge_base_ids = settings?.knowledge_base_ids || [];

    // Get collections from settings (defaultKnowledgeBaseNames) - legacy support
    const collections = settings?.defaultKnowledgeBaseNames || [];

    // Get language from phone settings first, fallback to AI behavior
    const language = phoneSettings?.language || aiBehavior?.voiceAgent?.language || 'en';

    // Get system prompt from AI behavior voice agent settings
    const agent_instruction = aiBehavior?.voiceAgent?.systemPrompt || '';

    // Get greeting message from phone settings (updated from UI)
    const greeting_message = phoneSettings?.greetingMessage || 'Hello! How can I help you today?';

    // Get e-commerce credentials if available
    const ecommerceCredentials = await getEcommerceCredentials(userId);

    console.log('[InboundAgentConfig Service] Using greeting_message:', greeting_message);
    console.log('[InboundAgentConfig Service] Using language:', language);
    console.log('[InboundAgentConfig Service] E-commerce integration:', ecommerceCredentials ? '✅ Available' : '❌ Not configured');

    // Get all phone numbers (both from PhoneSettings AND PhoneNumber model)
    const phoneSettingsNumbers = phoneSettings?.inboundPhoneNumbers || [];

    // Fetch all phone numbers associated with this user from PhoneNumber model
    // This ensures outbound-only numbers also get a config (needed for e-commerce)
    const PhoneNumber = (await import('../models/PhoneNumber')).default;
    const userPhoneNumbersDocs = await PhoneNumber.find({
      $or: [
        { userId: userId },
        { organizationId: (settings as any)?.organizationId || userId } // Handle org-level numbers if applicable
      ]
    });

    const allPhoneNumbers = new Set<string>([...phoneSettingsNumbers]);
    userPhoneNumbersDocs.forEach(doc => {
      if (doc.phone_number) {
        allPhoneNumbers.add(doc.phone_number);
      }
    });

    const inboundPhoneNumbers = Array.from(allPhoneNumbers);

    if (inboundPhoneNumbers.length === 0) {
      console.log('[InboundAgentConfig Service] No phone numbers found (checked Settings and PhoneNumber model)');
      // Create default config for chatbot anyway if no numbers
      if (ecommerceCredentials) {
        await this.createDefaultConfigForChatbot(userId, ecommerceCredentials);
      }
      return [];
    }

    console.log('[InboundAgentConfig Service] Found total', inboundPhoneNumbers.length, 'phone numbers (merged from settings + DB)');

    console.log('[InboundAgentConfig Service] Creating/updating configs for', inboundPhoneNumbers.length, 'phone numbers');

    // Create/update a config for each phone number
    const configs = [];
    for (let i = 0; i < inboundPhoneNumbers.length; i++) {
      const calledNumber = inboundPhoneNumbers[i];

      console.log(`[InboundAgentConfig Service] Processing phone number [${i}]:`, calledNumber);

      try {
        console.log(`[InboundAgentConfig Service] Looking for existing config:`, { userId, calledNumber });

        // Try to find existing config first
        let config = await InboundAgentConfig.findOne({ userId, calledNumber });

        if (config) {
          // Update existing - preserve greeting_message and language if already customized
          console.log(`[InboundAgentConfig Service] Found existing config, updating...`);
          console.log(`[InboundAgentConfig Service] Existing values:`, {
            voice_id: config.voice_id,
            language: config.language,
            greeting_message: config.greeting_message ? config.greeting_message.substring(0, 50) + '...' : 'empty'
          });

          // Always update these fields from latest settings
          config.voice_id = voice_id;
          config.knowledge_base_ids = knowledge_base_ids;
          config.collections = collections; // Legacy support
          config.agent_instruction = agent_instruction;

          // Update greeting_message from phone settings (when user explicitly sets it)
          console.log(`[InboundAgentConfig Service] Updating greeting_message from phone settings: ${greeting_message.substring(0, 50)}...`);
          config.greeting_message = greeting_message;

          // Update language from phone settings (when user explicitly sets it)
          console.log(`[InboundAgentConfig Service] Updating language from phone settings: ${language}`);
          config.language = language;

          // Update e-commerce credentials if available
          if (ecommerceCredentials) {
            config.ecommerce_credentials = ecommerceCredentials;
            console.log(`[InboundAgentConfig Service] Updated e-commerce credentials for platform: ${ecommerceCredentials.platform}`);
          }

          await config.save();
          console.log(`[InboundAgentConfig Service] Updated config for ${calledNumber}`);
        } else {
          // Create new
          console.log(`[InboundAgentConfig Service] No existing config found, creating new...`);
          const configData: any = {
            userId,
            calledNumber,
            voice_id,
            knowledge_base_ids,
            collections, // Legacy support
            language,
            agent_instruction,
            greeting_message
          };

          // Add e-commerce credentials if available
          if (ecommerceCredentials) {
            configData.ecommerce_credentials = ecommerceCredentials;
            console.log(`[InboundAgentConfig Service] Adding e-commerce credentials for platform: ${ecommerceCredentials.platform}`);
          }

          console.log(`[InboundAgentConfig Service] Creating with data:`, JSON.stringify({
            ...configData,
            ecommerce_credentials: configData.ecommerce_credentials ? { ...configData.ecommerce_credentials, api_key: '***', api_secret: '***' } : undefined
          }, null, 2));

          config = await InboundAgentConfig.create(configData);

          console.log(`[InboundAgentConfig Service] Created new config for ${calledNumber}, ID:`, config._id);
        }

        configs.push(config);
      } catch (error: any) {
        console.error(`[InboundAgentConfig Service] ERROR processing ${calledNumber}:`, error.message);
        console.error(`[InboundAgentConfig Service] Error stack:`, error.stack);
        // Continue with other numbers even if one fails
      }
    }

    // Remove configs for phone numbers that no longer exist
    const existingConfigs = await InboundAgentConfig.find({ userId });
    for (const existingConfig of existingConfigs) {
      if (!inboundPhoneNumbers.includes(existingConfig.calledNumber)) {
        console.log('[InboundAgentConfig Service] Removing obsolete config for:', existingConfig.calledNumber);
        await InboundAgentConfig.findByIdAndDelete(existingConfig._id);
      }
    }

    console.log('[InboundAgentConfig Service] Synced', configs.length, 'configs successfully');
    console.log('[InboundAgentConfig Service] Created/Updated configs for numbers:', configs.map(c => c.calledNumber));

    // Verify what's in DB after sync
    const allConfigsInDb = await InboundAgentConfig.find({ userId });
    console.log('[InboundAgentConfig Service] Total configs in DB for user:', allConfigsInDb.length);
    console.log('[InboundAgentConfig Service] Phone numbers in DB:', allConfigsInDb.map(c => c.calledNumber));

    return configs;
  }

  /**
   * Update specific fields in the inbound agent config for a specific phone number
   */
  async update(
    userId: string,
    calledNumber: string,
    data: {
      voice_id?: string;
      collections?: string[];
      language?: string;
      agent_instruction?: string;
      greeting_message?: string;
      ecommerce_credentials?: {
        platform?: string;
        base_url?: string;
        api_key?: string;
        api_secret?: string;
        access_token?: string;
      };
    }
  ) {
    console.log('[InboundAgentConfig Service] ==========================================');
    console.log('[InboundAgentConfig Service] UPDATE CONFIG CALLED');
    console.log('[InboundAgentConfig Service] UserId:', userId);
    console.log('[InboundAgentConfig Service] CalledNumber:', calledNumber);
    console.log('[InboundAgentConfig Service] Update Data:', JSON.stringify(data, null, 2));
    console.log('[InboundAgentConfig Service] ==========================================');

    let config = await InboundAgentConfig.findOne({ userId, calledNumber });

    if (!config) {
      // Create new config if doesn't exist
      console.log('[InboundAgentConfig Service] Config not found, creating new one...');
      config = await InboundAgentConfig.create({
        userId,
        calledNumber,
        ...data
      });
      console.log('[InboundAgentConfig Service] Created new config:', config._id);
    } else {
      // Update existing config
      console.log('[InboundAgentConfig Service] Updating existing config:', config._id);
      if (data.voice_id !== undefined) {
        config.voice_id = data.voice_id;
        console.log('[InboundAgentConfig Service] Updated voice_id:', data.voice_id);
      }
      if (data.collections !== undefined) {
        config.collections = data.collections;
        console.log('[InboundAgentConfig Service] Updated collections:', data.collections);
      }
      if (data.language !== undefined) {
        config.language = data.language;
        console.log('[InboundAgentConfig Service] Updated language:', data.language);
      }
      if (data.agent_instruction !== undefined) {
        config.agent_instruction = data.agent_instruction;
        console.log('[InboundAgentConfig Service] Updated agent_instruction');
      }
      if (data.greeting_message !== undefined) {
        config.greeting_message = data.greeting_message;
        console.log('[InboundAgentConfig Service] Updated greeting_message:', data.greeting_message);
      }

      // Update e-commerce credentials if provided
      if (data.ecommerce_credentials !== undefined) {
        config.ecommerce_credentials = data.ecommerce_credentials;
        console.log('[InboundAgentConfig Service] Updated e-commerce credentials');
      }

      await config.save();
      console.log('[InboundAgentConfig Service] Config saved successfully');
    }

    console.log('[InboundAgentConfig Service] Final config:', {
      _id: config._id,
      calledNumber: config.calledNumber,
      voice_id: config.voice_id,
      language: config.language,
      greeting_message: config.greeting_message
    });

    return config;
  }

  /**
   * Delete all inbound agent configs for a user
   */
  async deleteAll(userId: string): Promise<void> {
    await InboundAgentConfig.deleteMany({ userId });
  }

  /**
   * Delete inbound agent config for a specific phone number
   */
  async delete(userId: string, calledNumber: string): Promise<void> {
    await InboundAgentConfig.findOneAndDelete({ userId, calledNumber });
  }

  /**
   * Create a default InboundAgentConfig for chatbot use when no phone numbers are configured
   * Uses empty string as calledNumber to distinguish from phone-based configs
   */
  async createDefaultConfigForChatbot(
    userId: string,
    ecommerceCredentials: {
      platform?: string;
      base_url?: string;
      api_key?: string;
      api_secret?: string;
      access_token?: string;
    }
  ) {
    console.log('[InboundAgentConfig Service] Creating default config for chatbot...');

    // Use empty string as calledNumber for chatbot (distinguishes from phone-based configs)
    const calledNumber = '';

    // Check if default config already exists
    let config = await InboundAgentConfig.findOne({ userId, calledNumber });

    if (config) {
      // Update existing default config with e-commerce credentials
      console.log('[InboundAgentConfig Service] Updating existing default config for chatbot...');
      config.ecommerce_credentials = ecommerceCredentials;
      await config.save();
      console.log('[InboundAgentConfig Service] ✅ Updated default config for chatbot');
    } else {
      // Create new default config
      console.log('[InboundAgentConfig Service] Creating new default config for chatbot...');

      // Fetch settings to get default values
      const [phoneSettings, aiBehavior, settings] = await Promise.all([
        PhoneSettings.findOne({ userId }),
        AIBehavior.findOne({ userId }),
        Settings.findOne({ userId })
      ]);

      // Get default values
      const voice_id = phoneSettings?.customVoiceId || phoneSettings?.selectedVoice || 'adam';
      const knowledge_base_ids = settings?.knowledge_base_ids || [];
      const collections = settings?.defaultKnowledgeBaseNames || []; // Legacy support
      const language = phoneSettings?.language || aiBehavior?.voiceAgent?.language || 'en';
      const agent_instruction = aiBehavior?.voiceAgent?.systemPrompt || '';
      const greeting_message = phoneSettings?.greetingMessage || 'Hello! How can I help you today?';

      config = await InboundAgentConfig.create({
        userId,
        calledNumber, // Empty string for chatbot
        voice_id,
        knowledge_base_ids,
        collections, // Legacy support
        language,
        agent_instruction,
        greeting_message,
        ecommerce_credentials: ecommerceCredentials
      });

      console.log('[InboundAgentConfig Service] ✅ Created default config for chatbot with e-commerce credentials');
      console.log('[InboundAgentConfig Service] Config ID:', config._id);
      console.log('[InboundAgentConfig Service] Platform:', ecommerceCredentials.platform);
    }

    return config;
  }
}

export const inboundAgentConfigService = new InboundAgentConfigService();

