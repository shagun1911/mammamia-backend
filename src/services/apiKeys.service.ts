import mongoose from 'mongoose';
import ApiKeys from '../models/ApiKeys';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config/env';

export class ApiKeysService {
  /**
   * Get API keys for a user - now returns platform keys from environment variables
   * This method maintains the same interface but uses platform keys instead of user-provided keys
   */
  async getApiKeys(userId: string) {
    try {
      // Validate userId
      if (!userId || typeof userId !== 'string') {
        throw new AppError(400, 'INVALID_USER_ID', 'Invalid user ID provided');
      }

      // Get platform API keys from environment variables
      const provider = config.platform.defaultProvider;
      let apiKey: string;

      if (provider === 'openai') {
        apiKey = config.platform.openaiApiKey;
        if (!apiKey || apiKey.trim() === '') {
          console.error('[API Keys Service] Platform OpenAI API key not configured in environment variables');
          throw new AppError(500, 'PLATFORM_API_KEY_NOT_CONFIGURED', 'Platform OpenAI API key is not configured. Please set PLATFORM_OPENAI_API_KEY or OPENAI_API_KEY environment variable.');
        }
      } else if (provider === 'gemini') {
        apiKey = config.platform.geminiApiKey;
        if (!apiKey || apiKey.trim() === '') {
          console.error('[API Keys Service] Platform Gemini API key not configured in environment variables');
          throw new AppError(500, 'PLATFORM_API_KEY_NOT_CONFIGURED', 'Platform Gemini API key is not configured. Please set PLATFORM_GEMINI_API_KEY or GEMINI_API_KEY environment variable.');
        }
      } else {
        throw new AppError(500, 'INVALID_PROVIDER', `Invalid LLM provider: ${provider}`);
      }

      console.log('[API Keys Service] ✅ Using platform API key for userId:', userId, 'provider:', provider);
      
      // Return in the same format as before for compatibility
      return {
        userId: new mongoose.Types.ObjectId(userId),
        llmProvider: provider,
        apiKey: apiKey,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any;
    } catch (error: any) {
      // If it's already an AppError, re-throw it
      if (error instanceof AppError) {
        throw error;
      }
      console.error('[API Keys Service] Unexpected error in getApiKeys:', error);
      throw new AppError(500, 'API_KEYS_ERROR', `Failed to get API keys: ${error.message}`);
    }
  }

  /**
   * Update API keys - No-op since we use platform keys from environment variables
   * This method is kept for backward compatibility but doesn't actually update anything
   */
  async updateApiKeys(userId: string, data: { llmProvider?: string; apiKey?: string }) {
    try {
      console.log('[API Keys Service] Update API keys called but ignored - using platform keys from environment variables');
      
      // Return platform keys in the same format for compatibility
      const provider = config.platform.defaultProvider;
      let apiKey: string;

      if (provider === 'openai') {
        apiKey = config.platform.openaiApiKey;
      } else if (provider === 'gemini') {
        apiKey = config.platform.geminiApiKey;
      } else {
        apiKey = config.platform.openaiApiKey || '';
      }

      return {
        userId: new mongoose.Types.ObjectId(userId),
        llmProvider: provider,
        apiKey: apiKey,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any;
    } catch (error: any) {
      console.error('Error in updateApiKeys:', error);
      throw new AppError(500, 'API_KEYS_ERROR', `Failed to update API keys: ${error.message}`);
    }
  }

  /**
   * Delete API keys - No-op since we use platform keys from environment variables
   * This method is kept for backward compatibility but doesn't actually delete anything
   */
  async deleteApiKeys(userId: string) {
    try {
      console.log('[API Keys Service] Delete API keys called but ignored - using platform keys from environment variables');
      
      return { message: 'API keys deleted successfully' };
    } catch (error: any) {
      console.error('Error in deleteApiKeys:', error);
      throw new AppError(500, 'API_KEYS_ERROR', `Failed to delete API keys: ${error.message}`);
    }
  }
}

export const apiKeysService = new ApiKeysService();

