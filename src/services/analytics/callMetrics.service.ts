/**
 * Call Metrics Service
 * Centralized logic for calculating call minutes from transcripts
 */

import Conversation from '../../models/Conversation';
import mongoose from 'mongoose';
import { logger } from '../../utils/logger.util';
import { CallMetrics, DateRange } from './analytics.types';

export class CallMetricsService {
  /**
   * Calculate call minutes from transcript timestamps
   * Call minutes = (last transcript timestamp - first transcript timestamp) rounded up to nearest minute
   */
  private calculateDurationFromTranscript(transcript: any): number | null {
    try {
      if (!transcript || !transcript.items || !Array.isArray(transcript.items)) {
        return null;
      }

      const items = transcript.items.filter((item: any) => item.timestamp);
      if (items.length === 0) {
        return null;
      }

      // Sort by timestamp
      items.sort((a: any, b: any) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB;
      });

      const firstTimestamp = new Date(items[0].timestamp).getTime();
      const lastTimestamp = new Date(items[items.length - 1].timestamp).getTime();
      const durationMs = lastTimestamp - firstTimestamp;
      const durationMinutes = Math.ceil(durationMs / (1000 * 60)); // Round UP to nearest minute

      return durationMinutes > 0 ? durationMinutes : null;
    } catch (error: any) {
      logger.warn('[CallMetrics] Error calculating duration from transcript:', error.message);
      return null;
    }
  }

  /**
   * Get duration from conversation metadata or transcript
   * Priority: transcript timestamps > metadata.duration > time difference > default
   */
  private getCallDuration(conversation: any): number {
    // Priority 1: Calculate from transcript timestamps
    if (conversation.transcript) {
      const duration = this.calculateDurationFromTranscript(conversation.transcript);
      if (duration !== null && duration > 0) {
        return duration;
      }
    }

    // Priority 2: Use metadata.duration (could be in seconds or minutes)
    if (conversation.metadata?.duration) {
      const metaDuration = conversation.metadata.duration;
      if (typeof metaDuration === 'number') {
        // If > 100, assume seconds; otherwise assume minutes
        return metaDuration > 100 ? Math.ceil(metaDuration / 60) : metaDuration;
      } else if (typeof metaDuration === 'string') {
        // Try to parse formatted duration (e.g., "5:30" or "5m 30s")
        const parsed = this.parseDurationString(metaDuration);
        if (parsed > 0) return parsed;
      }
    }

    // Priority 3: Fallback to time difference (capped at 30 minutes)
    if (conversation.createdAt && conversation.updatedAt) {
      const diffMs = new Date(conversation.updatedAt).getTime() - new Date(conversation.createdAt).getTime();
      const diffMinutes = Math.ceil(diffMs / (1000 * 60));
      return Math.min(diffMinutes, 30); // Cap at 30 minutes
    }

    // Priority 4: Default to 2 minutes if no duration found
    return 2;
  }

  /**
   * Parse duration string (e.g., "5:30", "5m 30s", "330s")
   */
  private parseDurationString(durationStr: string): number {
    try {
      // Format: "MM:SS" or "HH:MM:SS"
      const timeParts = durationStr.split(':');
      if (timeParts.length === 2) {
        const minutes = parseInt(timeParts[0], 10);
        const seconds = parseInt(timeParts[1], 10);
        return Math.ceil(minutes + seconds / 60);
      } else if (timeParts.length === 3) {
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);
        const seconds = parseInt(timeParts[2], 10);
        return Math.ceil(hours * 60 + minutes + seconds / 60);
      }

      // Format: "5m 30s" or "330s"
      const minutesMatch = durationStr.match(/(\d+)m/);
      const secondsMatch = durationStr.match(/(\d+)s/);
      const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
      const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
      return Math.ceil(minutes + seconds / 60);
    } catch {
      return 0;
    }
  }

  /**
   * Get call metrics for a specific organization
   */
  async getOrganizationCallMetrics(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<CallMetrics> {
    try {
      const query: any = {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        channel: 'phone'
      };

      // Add date filter if provided
      if (dateRange?.dateFrom || dateRange?.dateTo) {
        query.createdAt = {};
        if (dateRange.dateFrom) {
          query.createdAt.$gte = new Date(dateRange.dateFrom);
        }
        if (dateRange.dateTo) {
          query.createdAt.$lte = new Date(dateRange.dateTo);
        }
      }

      const phoneConversations = await Conversation.find(query)
        .select('transcript metadata createdAt updatedAt')
        .lean();

      let totalCallMinutes = 0;
      let callsWithTranscript = 0;
      let callsWithoutTranscript = 0;

      for (const conv of phoneConversations) {
        const duration = this.getCallDuration(conv);
        totalCallMinutes += duration;

        if (conv.transcript && conv.transcript.items && conv.transcript.items.length > 0) {
          callsWithTranscript++;
        } else {
          callsWithoutTranscript++;
        }
      }

      const totalCalls = phoneConversations.length;
      const averageCallDuration = totalCalls > 0 ? totalCallMinutes / totalCalls : 0;

      return {
        totalCallMinutes,
        totalCalls,
        averageCallDuration: Math.round(averageCallDuration * 100) / 100, // Round to 2 decimals
        callsWithTranscript,
        callsWithoutTranscript
      };
    } catch (error: any) {
      logger.error('[CallMetrics] Error getting organization call metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get call metrics for a specific user
   */
  async getUserCallMetrics(
    userId: string,
    dateRange?: DateRange
  ): Promise<CallMetrics> {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(userId).select('organizationId').lean() as any;
      
      if (!user || !user.organizationId) {
        return {
          totalCallMinutes: 0,
          totalCalls: 0,
          averageCallDuration: 0,
          callsWithTranscript: 0,
          callsWithoutTranscript: 0
        };
      }

      return this.getOrganizationCallMetrics(user.organizationId.toString(), dateRange);
    } catch (error: any) {
      logger.error('[CallMetrics] Error getting user call metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get platform-wide call metrics (admin)
   */
  async getPlatformCallMetrics(dateRange?: DateRange): Promise<CallMetrics> {
    try {
      const query: any = { channel: 'phone' };

      // Add date filter if provided
      if (dateRange?.dateFrom || dateRange?.dateTo) {
        query.createdAt = {};
        if (dateRange.dateFrom) {
          query.createdAt.$gte = new Date(dateRange.dateFrom);
        }
        if (dateRange.dateTo) {
          query.createdAt.$lte = new Date(dateRange.dateTo);
        }
      }

      const phoneConversations = await Conversation.find(query)
        .select('transcript metadata createdAt updatedAt')
        .lean();

      let totalCallMinutes = 0;
      let callsWithTranscript = 0;
      let callsWithoutTranscript = 0;

      for (const conv of phoneConversations) {
        const duration = this.getCallDuration(conv);
        totalCallMinutes += duration;

        if (conv.transcript && conv.transcript.items && conv.transcript.items.length > 0) {
          callsWithTranscript++;
        } else {
          callsWithoutTranscript++;
        }
      }

      const totalCalls = phoneConversations.length;
      const averageCallDuration = totalCalls > 0 ? totalCallMinutes / totalCalls : 0;

      return {
        totalCallMinutes,
        totalCalls,
        averageCallDuration: Math.round(averageCallDuration * 100) / 100,
        callsWithTranscript,
        callsWithoutTranscript
      };
    } catch (error: any) {
      logger.error('[CallMetrics] Error getting platform call metrics:', error.message);
      throw error;
    }
  }
}

export const callMetricsService = new CallMetricsService();
