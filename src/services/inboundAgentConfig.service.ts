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
   */
  async getByPhoneNumber(userId: string, calledNumber: string) {
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
    
    // Get collections from settings (defaultKnowledgeBaseNames)
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

    // Get all inbound phone numbers
    const inboundPhoneNumbers = phoneSettings?.inboundPhoneNumbers || [];
    
    if (inboundPhoneNumbers.length === 0) {
      console.log('[InboundAgentConfig Service] No inbound phone numbers found');
      return [];
    }

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
          config.collections = collections;
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
            collections,
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
}

export const inboundAgentConfigService = new InboundAgentConfigService();

