import User from '../models/User';
import { logger } from '../utils/logger.util';
import { usageTrackerService } from './usage/usageTracker.service';

/**
 * Usage Service
 * 
 * Handles incrementing usage counters on User.subscription.usage
 * This is called after successful actions (conversations, calls, automations)
 */
export class UsageService {
  /**
   * Helper: Clear organization cache if user has one
   */
  private async invalidateCache(userId: string): Promise<void> {
    try {
      const user = await User.findById(userId).select('organizationId').lean();
      if (user?.organizationId) {
        await usageTrackerService.clearUsageCache(user.organizationId.toString());
      }
    } catch (err) {
      // Ignore cache clearing errors
    }
  }

  /**
   * Increment conversation usage
   */
  async incrementConversations(userId: string, count: number = 1): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.conversations': count } }
      );
      await this.invalidateCache(userId);
      logger.debug(`[Usage] Incremented conversations for user ${userId} by ${count}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment conversations for user ${userId}`, {
        error: error.message
      });
    }
  }

  /**
   * Increment voice minutes usage
   */
  async incrementMinutes(userId: string, minutes: number): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.minutes': minutes } }
      );
      await this.invalidateCache(userId);
      logger.debug(`[Usage] Incremented minutes for user ${userId} by ${minutes}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment minutes for user ${userId}`, {
        error: error.message
      });
    }
  }

  /**
   * Increment automations usage
   */
  async incrementAutomations(userId: string, count: number = 1): Promise<void> {
    try {
      await User.findByIdAndUpdate(
        userId,
        { $inc: { 'subscription.usage.automations': count } }
      );
      await this.invalidateCache(userId);
      logger.debug(`[Usage] Incremented automations for user ${userId} by ${count}`);
    } catch (error: any) {
      logger.error(`[Usage] Failed to increment automations for user ${userId}`, {
        error: error.message
      });
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
      const user = await User.findById(userId).select('organizationId subscription.usage').lean();
      if (!user) return null;

      // Primary source: Aggregation from Tracker
      if (user.organizationId) {
        const agg = await usageTrackerService.getOrganizationUsage(user.organizationId.toString());
        return {
          conversations: agg.chatMessages,
          minutes: agg.callMinutes,
          automations: agg.automations
        };
      }

      // Fallback: Legacy stored usage
      return {
        conversations: user.subscription?.usage?.conversations || 0,
        minutes: user.subscription?.usage?.minutes || 0,
        automations: user.subscription?.usage?.automations || 0
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

