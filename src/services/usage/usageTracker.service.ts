import mongoose from 'mongoose';
import Message from '../../models/Message';
import Conversation from '../../models/Conversation';
import Automation from '../../models/Automation';
import Campaign from '../../models/Campaign';
import { logger } from '../../utils/logger.util';

/**
 * SINGLE SOURCE OF TRUTH FOR USAGE TRACKING
 * 
 * Rules:
 * - No duplicate counting
 * - No manual increments
 * - No frontend calculations
 * - All counts derived from stored events/transcripts
 */

export class UsageTrackerService {
  /**
   * Calculate call minutes from actual phone conversations
   * 
   * Call minute = conversation with channel='phone' + actual transcript duration
   */
  async calculateCallMinutes(organizationId: string): Promise<number> {
    try {
      const conversations = await Conversation.find({
        organizationId,
        channel: 'phone'
      }).lean();

      let totalMinutes = 0;

      for (const conv of conversations) {
        let duration = 0;

        // Method 1: Calculate from transcript items (most accurate)
        if (conv.transcript && Array.isArray(conv.transcript)) {
          const timestamps = conv.transcript
            .map((item: any) => item.timestamp || item.time)
            .filter(Boolean)
            .map((ts: any) => new Date(ts).getTime())
            .sort((a: number, b: number) => a - b);

          if (timestamps.length >= 2) {
            const firstTime = timestamps[0];
            const lastTime = timestamps[timestamps.length - 1];
            duration = Math.ceil((lastTime - firstTime) / 1000 / 60); // Round up to minutes
          }
        }

        // Method 2: Use metadata.duration if available
        if (duration === 0 && conv.metadata?.duration) {
          const metaDuration = parseInt(String(conv.metadata.duration), 10);
          if (!isNaN(metaDuration)) {
            duration = Math.ceil(metaDuration / 60); // Assuming metadata.duration is in seconds
          }
        }

        // Method 3: Calculate from createdAt to updatedAt (with reasonable cap)
        if (duration === 0 && conv.createdAt && conv.updatedAt) {
          const start = new Date(conv.createdAt).getTime();
          const end = new Date(conv.updatedAt).getTime();
          const diffMinutes = (end - start) / 1000 / 60;

          // Only count if duration is reasonable (< 2 hours)
          if (diffMinutes > 0 && diffMinutes < 120) {
            duration = Math.ceil(diffMinutes);
          }
        }

        totalMinutes += duration;
      }

      logger.info(`[Usage Tracker] Org ${organizationId}: ${totalMinutes} call minutes from ${conversations.length} phone conversations`);
      return totalMinutes;

    } catch (error: any) {
      logger.error('[Usage Tracker] Error calculating call minutes:', error.message);
      return 0;
    }
  }

  /**
   * Calculate total chat messages sent + received
   * 
   * Chat message = every message in non-phone channels
   */
  async calculateChatMessages(organizationId: string): Promise<number> {
    try {
      const count = await Message.countDocuments({
        organizationId,
        // Exclude phone channel messages from chat count
        $or: [
          { channel: { $exists: false } },
          { channel: { $ne: 'phone' } }
        ]
      });

      logger.info(`[Usage Tracker] Org ${organizationId}: ${count} chat messages`);
      return count;

    } catch (error: any) {
      logger.error('[Usage Tracker] Error calculating chat messages:', error.message);
      return 0;
    }
  }

  /**
   * Calculate conversations count
   * 
   * Conversation = at least 1 user message + 1 bot/system reply
   */
  async calculateConversations(organizationId: string): Promise<number> {
    try {
      const conversations = await Conversation.aggregate([
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(organizationId)
          }
        },
        {
          $lookup: {
            from: 'messages',
            localField: '_id',
            foreignField: 'conversationId',
            as: 'messages'
          }
        },
        {
          $match: {
            'messages.1': { $exists: true } // At least 2 messages
          }
        },
        {
          $count: 'total'
        }
      ]);

      const count = conversations[0]?.total || 0;
      logger.info(`[Usage Tracker] Org ${organizationId}: ${count} conversations`);
      return count;

    } catch (error: any) {
      logger.error('[Usage Tracker] Error calculating conversations:', error.message);
      return 0;
    }
  }

  /**
   * Count active automations
   */
  async calculateActiveAutomations(organizationId: string): Promise<number> {
    try {
      const count = await Automation.countDocuments({
        organizationId,
        isActive: true
      });

      logger.info(`[Usage Tracker] Org ${organizationId}: ${count} active automations`);
      return count;

    } catch (error: any) {
      logger.error('[Usage Tracker] Error calculating automations:', error.message);
      return 0;
    }
  }

  /**
   * Count campaign sends (total messages sent via campaigns)
   */
  async calculateCampaignSends(organizationId: string): Promise<number> {
    try {
      const campaigns = await Campaign.find({ organizationId }).lean();
      
      let totalSends = 0;
      for (const campaign of campaigns) {
        // Count from contactIds array length or totalContacts field
        totalSends += (campaign as any).contactIds?.length || (campaign as any).totalContacts || 0;
      }

      logger.info(`[Usage Tracker] Org ${organizationId}: ${totalSends} campaign sends`);
      return totalSends;

    } catch (error: any) {
      logger.error('[Usage Tracker] Error calculating campaign sends:', error.message);
      return 0;
    }
  }

  /**
   * Get comprehensive usage for an organization
   */
  async getOrganizationUsage(organizationId: string) {
    try {
      const [callMinutes, chatMessages, conversations, automations, campaignSends] = await Promise.all([
        this.calculateCallMinutes(organizationId),
        this.calculateChatMessages(organizationId),
        this.calculateConversations(organizationId),
        this.calculateActiveAutomations(organizationId),
        this.calculateCampaignSends(organizationId)
      ]);

      return {
        callMinutes,
        chatMessages,
        conversations,
        automations,
        campaignSends,
        calculatedAt: new Date()
      };

    } catch (error: any) {
      logger.error('[Usage Tracker] Error getting organization usage:', error.message);
      throw error;
    }
  }

  /**
   * Check if organization has exceeded plan limits
   */
  async checkLimits(organizationId: string, plan: any): Promise<{
    exceeded: boolean;
    limits: {
      callMinutes: { used: number; limit: number; exceeded: boolean };
      chatMessages: { used: number; limit: number; exceeded: boolean };
      automations: { used: number; limit: number; exceeded: boolean };
    };
  }> {
    try {
      const usage = await this.getOrganizationUsage(organizationId);

      const limits = {
        callMinutes: {
          used: usage.callMinutes,
          limit: plan.features?.callMinutes || 0,
          exceeded: plan.features?.callMinutes !== -1 && usage.callMinutes > plan.features?.callMinutes
        },
        chatMessages: {
          used: usage.chatMessages,
          limit: plan.features?.chatConversations || 0,
          exceeded: plan.features?.chatConversations !== -1 && usage.chatMessages > plan.features?.chatConversations
        },
        automations: {
          used: usage.automations,
          limit: plan.features?.automations || 0,
          exceeded: plan.features?.automations !== -1 && usage.automations > plan.features?.automations
        }
      };

      const exceeded = limits.callMinutes.exceeded || 
                       limits.chatMessages.exceeded || 
                       limits.automations.exceeded;

      return { exceeded, limits };

    } catch (error: any) {
      logger.error('[Usage Tracker] Error checking limits:', error.message);
      throw error;
    }
  }
}

export const usageTrackerService = new UsageTrackerService();
