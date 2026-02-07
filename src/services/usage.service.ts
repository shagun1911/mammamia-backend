import User from '../models/User';
import { logger } from '../utils/logger.util';

/**
 * Usage Service
 * 
 * Handles incrementing usage counters on User.subscription.usage
 * This is called after successful actions (conversations, calls, automations)
 */
export class UsageService {
  /**
   * Increment conversation usage
   */
  async incrementConversations(userId: string, count: number = 1): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.conversations': count } },
        { new: true }
      );
      logger.debug(`[Usage] Incremented conversations for user ${userId} by ${count}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment conversations for user ${userId}`, {
        error: error.message
      });
      // Don't throw - usage tracking failure shouldn't break the main operation
    }
  }

  /**
   * Increment voice minutes usage
   */
  async incrementMinutes(userId: string, minutes: number): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.minutes': minutes } },
        { new: true }
      );
      logger.debug(`[Usage] Incremented minutes for user ${userId} by ${minutes}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment minutes for user ${userId}`, {
        error: error.message
      });
      // Don't throw - usage tracking failure shouldn't break the main operation
    }
  }

  /**
   * Increment automations usage
   */
  async incrementAutomations(userId: string, count: number = 1): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.automations': count } },
        { new: true }
      );
      logger.debug(`[Usage] Incremented automations for user ${userId} by ${count}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment automations for user ${userId}`, {
        error: error.message
      });
      // Don't throw - usage tracking failure shouldn't break the main operation
    }
  }

  /**
   * Get current usage for a user
   */
  async getUsage(userId: string): Promise<{
    conversations: number;
    minutes: number;
    automations: number;
  } | null> {
    try {
      const user = await User.findById(userId).select('subscription.usage').lean();
      if (!user || !user.subscription) {
        return null;
      }
      return {
        conversations: user.subscription.usage?.conversations || 0,
        minutes: user.subscription.usage?.minutes || 0,
        automations: user.subscription.usage?.automations || 0
      };
    } catch (error: any) {
      logger.error(`[Usage] Failed to get usage for user ${userId}`, {
        error: error.message
      });
      return null;
    }
  }
}

export const usageService = new UsageService();

