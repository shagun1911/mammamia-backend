import AIBehavior from '../models/AIBehavior';
import { AppError } from '../middleware/error.middleware';
import { inboundAgentConfigService } from './inboundAgentConfig.service';

/**
 * AI Behavior Service
 * Manages Chat Agent and Voice Agent behavior configurations
 */
export class AIBehaviorService {
  /**
   * Get AI behavior configuration for a user (creates default if doesn't exist)
   */
  async get(userId: string) {
    try {
      let aiBehavior = await AIBehavior.findOne({ userId }).populate('knowledgeBaseId');

      if (!aiBehavior) {
        console.log('[AI Behavior] No configuration found for user, creating default');
        aiBehavior = await AIBehavior.create({
          userId,
          chatAgent: {
            improvements: '',
            systemPrompt: 'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.',
            humanOperator: {
              escalationRules: [],
              availability: {
                alwaysAvailable: false,
                schedule: new Map()
              }
            }
          },
          voiceAgent: {
            improvements: '',
            systemPrompt: 'You are a helpful AI voice assistant. Speak clearly, be empathetic, and provide concise answers.',
            language: 'en', // Default to English
            humanOperator: {
              phoneNumber: '',
              escalationRules: [],
              availability: {
                alwaysAvailable: false,
                schedule: new Map()
              }
            }
          }
        });
      }

      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to get configuration:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to get AI behavior configuration');
    }
  }

  /**
   * Update Chat Agent improvements
   */
  async updateChatAgentImprovements(userId: string, improvements: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.chatAgent.improvements = improvements;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated chat agent improvements');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update chat agent improvements:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update chat agent improvements');
    }
  }

  /**
   * Update Chat Agent system prompt
   */
  async updateChatAgentPrompt(userId: string, systemPrompt: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.chatAgent.systemPrompt = systemPrompt;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated chat agent system prompt');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update chat agent prompt:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update chat agent system prompt');
    }
  }

  /**
   * Update Chat Agent human operator configuration
   */
  async updateChatAgentHumanOperator(userId: string, config: {
    escalationRules?: string[];
    availability?: {
      alwaysAvailable: boolean;
      schedule: Map<string, { enabled: boolean; from: string; to: string }>;
    };
  }) {
    try {
      const aiBehavior = await this.get(userId);
      
      if (config.escalationRules !== undefined) {
        aiBehavior.chatAgent.humanOperator.escalationRules = config.escalationRules;
      }
      
      if (config.availability !== undefined) {
        aiBehavior.chatAgent.humanOperator.availability = config.availability;
      }
      
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated chat agent human operator configuration');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update chat agent human operator:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update chat agent human operator configuration');
    }
  }

  /**
   * Update Voice Agent improvements
   */
  async updateVoiceAgentImprovements(userId: string, improvements: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.voiceAgent.improvements = improvements;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated voice agent improvements');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update voice agent improvements:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update voice agent improvements');
    }
  }

  /**
   * Update Voice Agent system prompt
   */
  async updateVoiceAgentPrompt(userId: string, systemPrompt: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.voiceAgent.systemPrompt = systemPrompt;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated voice agent system prompt');
      
      // Sync inbound agent config after voice agent update
      try {
        console.log('[AI Behavior] Syncing inbound agent config...');
        await inboundAgentConfigService.syncConfig(userId);
        console.log('[AI Behavior] Inbound agent config synced successfully');
      } catch (error) {
        console.error('[AI Behavior] Failed to sync inbound agent config:', error);
        // Don't throw error, just log it
      }
      
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update voice agent prompt:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update voice agent system prompt');
    }
  }

  /**
   * Update Voice Agent language
   */
  async updateVoiceAgentLanguage(userId: string, language: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.voiceAgent.language = language;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated voice agent language');
      
      // Sync inbound agent config after language update
      try {
        console.log('[AI Behavior] Syncing inbound agent config...');
        await inboundAgentConfigService.syncConfig(userId);
        console.log('[AI Behavior] Inbound agent config synced successfully');
      } catch (error) {
        console.error('[AI Behavior] Failed to sync inbound agent config:', error);
        // Don't throw error, just log it
      }
      
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update voice agent language:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update voice agent language');
    }
  }

  /**
   * Update Voice Agent human operator configuration
   */
  async updateVoiceAgentHumanOperator(userId: string, config: {
    phoneNumber?: string;
    escalationRules?: string[];
    availability?: {
      alwaysAvailable: boolean;
      schedule: Map<string, { enabled: boolean; from: string; to: string }>;
    };
  }) {
    try {
      const aiBehavior = await this.get(userId);
      
      if (config.phoneNumber !== undefined) {
        aiBehavior.voiceAgent.humanOperator.phoneNumber = config.phoneNumber;
      }
      
      if (config.escalationRules !== undefined) {
        aiBehavior.voiceAgent.humanOperator.escalationRules = config.escalationRules;
      }
      
      if (config.availability !== undefined) {
        aiBehavior.voiceAgent.humanOperator.availability = config.availability;
      }
      
      await aiBehavior.save();
      
      console.log('[AI Behavior] Updated voice agent human operator configuration');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to update voice agent human operator:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to update voice agent human operator configuration');
    }
  }

  /**
   * Set knowledge base for AI behavior
   */
  async setKnowledgeBase(userId: string, knowledgeBaseId: string) {
    try {
      const aiBehavior = await this.get(userId);
      aiBehavior.knowledgeBaseId = knowledgeBaseId as any;
      await aiBehavior.save();
      
      console.log('[AI Behavior] Knowledge base linked');
      return aiBehavior;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to set knowledge base:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to set knowledge base');
    }
  }

  /**
   * Get combined system prompt for chat (knowledge base + chat agent prompt)
   */
  async getChatSystemPrompt(userId: string, knowledgeBaseContext?: string) {
    try {
      const aiBehavior = await this.get(userId);
      let systemPrompt = aiBehavior.chatAgent.systemPrompt || 'You are a helpful AI assistant.';
      
      if (knowledgeBaseContext) {
        systemPrompt = `${systemPrompt}\n\nKnowledge Base Context:\n${knowledgeBaseContext}`;
      }
      
      return systemPrompt;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to get chat system prompt:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to get chat system prompt');
    }
  }

  /**
   * Get combined system prompt for voice (knowledge base + voice agent prompt)
   */
  async getVoiceSystemPrompt(userId: string, knowledgeBaseContext?: string) {
    try {
      const aiBehavior = await this.get(userId);
      let systemPrompt = aiBehavior.voiceAgent.systemPrompt || 'You are a helpful AI voice assistant.';
      
      if (knowledgeBaseContext) {
        systemPrompt = `${systemPrompt}\n\nKnowledge Base Context:\n${knowledgeBaseContext}`;
      }
      
      return systemPrompt;
    } catch (error: any) {
      console.error('[AI Behavior] Failed to get voice system prompt:', error);
      throw new AppError(500, 'AI_BEHAVIOR_ERROR', 'Failed to get voice system prompt');
    }
  }

  /**
   * Get voice agent language
   */
  async getVoiceAgentLanguage(userId: string): Promise<string> {
    try {
      const aiBehavior = await this.get(userId);
      return aiBehavior.voiceAgent.language || 'en';
    } catch (error: any) {
      console.error('[AI Behavior] Failed to get voice agent language:', error);
      return 'en'; // Default fallback
    }
  }
}

export const aiBehaviorService = new AIBehaviorService();

