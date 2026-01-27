import OutboundAgentConfig, { IOutboundAgentConfig } from '../models/OutboundAgentConfig';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

export interface CreateOutboundAgentConfigData {
  outboundNumber: string;
  selectedVoice?: string;
  customVoiceId?: string;
  humanOperatorPhone?: string;
  escalationRules?: string[];
  greetingMessage?: string;
  language?: string;
}

export interface UpdateOutboundAgentConfigData {
  selectedVoice?: string;
  customVoiceId?: string;
  humanOperatorPhone?: string;
  escalationRules?: string[];
  greetingMessage?: string;
  language?: string;
}

export class OutboundAgentConfigService {
  /**
   * Get all outbound agent configs for a user
   */
  async getAll(userId: string): Promise<IOutboundAgentConfig[]> {
    console.log(`📞 [OutboundAgentConfig Service] Loading all outbound configs for User: ${userId}`);
    const configs = await OutboundAgentConfig.find({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
    console.log(`✅ [OutboundAgentConfig Service] Loaded ${configs.length} outbound config(s) for ${configs.map(c => c.outboundNumber).join(', ')}`);
    return configs;
  }

  /**
   * Get config for a specific outbound number
   */
  async getByOutboundNumber(userId: string, outboundNumber: string): Promise<IOutboundAgentConfig | null> {
    console.log(`📞 [OutboundAgentConfig Service] Loading outbound config for ${outboundNumber}, User: ${userId}`);
    const config = await OutboundAgentConfig.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      outboundNumber 
    });
    if (config) {
      console.log(`✅ [OutboundAgentConfig Service] Loaded outbound config for ${outboundNumber}`);
    } else {
      console.log(`ℹ️ [OutboundAgentConfig Service] No config found for ${outboundNumber}`);
    }
    return config;
  }

  /**
   * Create or update outbound agent config
   * NEVER overwrites configs of other numbers (enforced by unique index)
   */
  async createOrUpdate(
    userId: string,
    outboundNumber: string,
    data: CreateOutboundAgentConfigData | UpdateOutboundAgentConfigData
  ): Promise<IOutboundAgentConfig> {
    console.log(`📞 [OutboundAgentConfig Service] Creating/updating config for number: ${outboundNumber}, User: ${userId}`);
    console.log(`📞 [OutboundAgentConfig Service] Data:`, JSON.stringify(data, null, 2));
    
    let config = await OutboundAgentConfig.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      outboundNumber 
    });

    if (config) {
      // Update existing config for THIS number only
      console.log(`✅ [OutboundAgentConfig Service] Updating existing config for ${outboundNumber}`);
      if (data.selectedVoice !== undefined) config.selectedVoice = data.selectedVoice;
      if (data.customVoiceId !== undefined) config.customVoiceId = data.customVoiceId;
      if (data.humanOperatorPhone !== undefined) config.humanOperatorPhone = data.humanOperatorPhone;
      if (data.escalationRules !== undefined) config.escalationRules = data.escalationRules;
      if (data.greetingMessage !== undefined) config.greetingMessage = data.greetingMessage;
      if (data.language !== undefined) config.language = data.language;
    } else {
      // Create new config for THIS number only
      console.log(`🆕 [OutboundAgentConfig Service] Creating new config for ${outboundNumber}`);
      config = await OutboundAgentConfig.create({
        userId: new mongoose.Types.ObjectId(userId),
        outboundNumber, // This ensures config is scoped to THIS number only
        selectedVoice: data.selectedVoice || 'adam',
        customVoiceId: data.customVoiceId || '',
        humanOperatorPhone: data.humanOperatorPhone || '',
        escalationRules: data.escalationRules || [],
        greetingMessage: data.greetingMessage || 'Hello! How can I help you today?',
        language: data.language || 'en'
      });
    }

    await config.save();
    console.log(`✅ [OutboundAgentConfig Service] Saved config for ${outboundNumber}. Config ID: ${config._id}`);
    return config;
  }

  /**
   * Update outbound agent config
   */
  async update(
    userId: string,
    outboundNumber: string,
    data: UpdateOutboundAgentConfigData
  ): Promise<IOutboundAgentConfig> {
    const config = await OutboundAgentConfig.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      outboundNumber 
    });

    if (!config) {
      throw new AppError(404, 'NOT_FOUND', `Outbound agent config not found for number ${outboundNumber}`);
    }

    if (data.selectedVoice !== undefined) config.selectedVoice = data.selectedVoice;
    if (data.customVoiceId !== undefined) config.customVoiceId = data.customVoiceId;
    if (data.humanOperatorPhone !== undefined) config.humanOperatorPhone = data.humanOperatorPhone;
    if (data.escalationRules !== undefined) config.escalationRules = data.escalationRules;
    if (data.greetingMessage !== undefined) config.greetingMessage = data.greetingMessage;
    if (data.language !== undefined) config.language = data.language;

    await config.save();
    return config;
  }

  /**
   * Delete outbound agent config
   */
  async delete(userId: string, outboundNumber: string): Promise<void> {
    await OutboundAgentConfig.findOneAndDelete({ 
      userId: new mongoose.Types.ObjectId(userId), 
      outboundNumber 
    });
  }

  /**
   * Delete all outbound agent configs for a user
   */
  async deleteAll(userId: string): Promise<void> {
    await OutboundAgentConfig.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
  }
}

export const outboundAgentConfigService = new OutboundAgentConfigService();
