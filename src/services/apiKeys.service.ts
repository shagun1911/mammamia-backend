import mongoose from 'mongoose';
import ApiKeys from '../models/ApiKeys';
import { AppError } from '../middleware/error.middleware';

export class ApiKeysService {
  /**
   * Get API keys for a user (create default if doesn't exist)
   */
  async getApiKeys(userId: string) {
    try {
      // Convert string to ObjectId
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      let apiKeys = await ApiKeys.findOne({ userId: userObjectId });
      
      if (!apiKeys) {
        // Don't create a default entry with empty apiKey - throw error instead
        throw new AppError(404, 'API_KEYS_NOT_CONFIGURED', 'API keys not configured. Please configure your API keys in Settings.');
      }
      
      return apiKeys;
    } catch (error: any) {
      console.error('Error in getApiKeys:', error);
      throw error;
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

