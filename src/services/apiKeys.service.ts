import mongoose from 'mongoose';
import ApiKeys from '../models/ApiKeys';
import { AppError } from '../middleware/error.middleware';

export class ApiKeysService {
  /**
   * Get API keys for a user (create default if doesn't exist)
   */
  async getApiKeys(userId: string) {
    try {
      // Validate userId
      if (!userId || typeof userId !== 'string') {
        throw new AppError(400, 'INVALID_USER_ID', 'Invalid user ID provided');
      }

      // Convert string to ObjectId
      let userObjectId: mongoose.Types.ObjectId;
      try {
        userObjectId = new mongoose.Types.ObjectId(userId);
      } catch (error: any) {
        console.error('[API Keys Service] Invalid ObjectId format:', userId);
        throw new AppError(400, 'INVALID_USER_ID', `Invalid user ID format: ${userId}`);
      }
      
      console.log('[API Keys Service] Looking for API keys for userId:', userId, '(ObjectId:', userObjectId.toString(), ')');
      
      // Try multiple query approaches to find API keys
      let apiKeys = await ApiKeys.findOne({ userId: userObjectId });
      
      // If not found, try querying as string (in case of type mismatch)
      if (!apiKeys) {
        console.log('[API Keys Service] Not found with ObjectId query, trying string query...');
        apiKeys = await ApiKeys.findOne({ userId: userId });
      }
      
      // If still not found, try with both ObjectId and string in $or
      if (!apiKeys) {
        console.log('[API Keys Service] Not found with string query, trying $or query...');
        apiKeys = await ApiKeys.findOne({
          $or: [
            { userId: userObjectId },
            { userId: userId }
          ]
        });
      }
      
      // Debug: Check if ANY API keys exist in the database
      if (!apiKeys) {
        const totalApiKeys = await ApiKeys.countDocuments();
        console.log('[API Keys Service] Total API keys documents in database:', totalApiKeys);
        
        if (totalApiKeys > 0) {
          // Get a sample to see the structure
          const sample = await ApiKeys.findOne().lean();
          console.log('[API Keys Service] Sample API keys document structure:', {
            userId: sample?.userId,
            userIdType: typeof sample?.userId,
            hasApiKey: !!sample?.apiKey,
            provider: sample?.llmProvider
          });
        }
        
        console.error('[API Keys Service] API keys document not found for userId:', userId);
        throw new AppError(404, 'API_KEYS_NOT_CONFIGURED', 'API keys not configured. Please configure your API keys in Settings → API Keys.');
      }

      // Check if apiKey is actually set (not empty/null)
      if (!apiKeys.apiKey || apiKeys.apiKey.trim() === '') {
        console.error('[API Keys Service] API keys document exists but apiKey is empty for userId:', userId);
        throw new AppError(400, 'API_KEY_EMPTY', 'API key is not set. Please configure your API key in Settings → API Keys.');
      }

      console.log('[API Keys Service] ✅ API keys found for userId:', userId, 'provider:', apiKeys.llmProvider);
      
      return apiKeys;
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
   * Update API keys
   */
  async updateApiKeys(userId: string, data: { llmProvider?: string; apiKey?: string }) {
    try {
      // Convert string to ObjectId
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      let apiKeys = await ApiKeys.findOne({ userId: userObjectId });
      
      if (!apiKeys) {
        apiKeys = await ApiKeys.create({
          userId: userObjectId,
          llmProvider: data.llmProvider || 'openai',
          apiKey: data.apiKey || ''
        });
      } else {
        if (data.llmProvider !== undefined) {
          apiKeys.llmProvider = data.llmProvider as 'openai' | 'gemini';
        }
        if (data.apiKey !== undefined) {
          apiKeys.apiKey = data.apiKey;
        }
        await apiKeys.save();
      }
      
      return apiKeys;
    } catch (error: any) {
      console.error('Error in updateApiKeys:', error);
      throw new AppError(500, 'API_KEYS_ERROR', `Failed to update API keys: ${error.message}`);
    }
  }

  /**
   * Delete API keys
   */
  async deleteApiKeys(userId: string) {
    try {
      // Convert string to ObjectId
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      const result = await ApiKeys.findOneAndDelete({ userId: userObjectId });
      
      if (!result) {
        throw new AppError(404, 'API_KEYS_NOT_FOUND', 'API keys not found');
      }
      
      return { message: 'API keys deleted successfully' };
    } catch (error: any) {
      console.error('Error in deleteApiKeys:', error);
      throw new AppError(500, 'API_KEYS_ERROR', `Failed to delete API keys: ${error.message}`);
    }
  }
}

export const apiKeysService = new ApiKeysService();

