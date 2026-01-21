/**
 * Centralized Analytics Service
 * Single source of truth for all analytics calculations
 * 
 * This service provides a unified interface for:
 * - Call minutes
 * - Chat conversations
 * - Total chats/messages
 * 
 * All dashboards (admin, user, organization) should use this service.
 */

import { callMetricsService } from './callMetrics.service';
import { chatMetricsService } from './chatMetrics.service';
import { logger } from '../../utils/logger.util';
import {
  AnalyticsResult,
  OrganizationMetrics,
  UserMetrics,
  AdminMetrics,
  DateRange
} from './analytics.types';
import Organization from '../../models/Organization';
import User from '../../models/User';
import mongoose from 'mongoose';

export class AnalyticsService {
  /**
   * Get analytics for a specific organization
   */
  async getOrganizationMetrics(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<AnalyticsResult> {
    try {
      const [callMetrics, chatMetrics] = await Promise.all([
        callMetricsService.getOrganizationCallMetrics(organizationId, dateRange),
        chatMetricsService.getOrganizationChatMetrics(organizationId, dateRange)
      ]);

      return {
        callMinutes: callMetrics.totalCallMinutes,
        totalConversations: chatMetrics.totalConversations,
        totalChats: chatMetrics.totalChats
      };
    } catch (error: any) {
      logger.error('[Analytics] Error getting organization metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get analytics for a specific user
   */
  async getUserMetrics(
    userId: string,
    dateRange?: DateRange
  ): Promise<AnalyticsResult> {
    try {
      const [callMetrics, chatMetrics] = await Promise.all([
        callMetricsService.getUserCallMetrics(userId, dateRange),
        chatMetricsService.getUserChatMetrics(userId, dateRange)
      ]);

      return {
        callMinutes: callMetrics.totalCallMinutes,
        totalConversations: chatMetrics.totalConversations,
        totalChats: chatMetrics.totalChats
      };
    } catch (error: any) {
      logger.error('[Analytics] Error getting user metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get detailed organization metrics (for admin dashboard)
   */
  async getOrganizationMetricsDetailed(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<OrganizationMetrics> {
    try {
      const organization = await Organization.findById(organizationId).lean();
      if (!organization) {
        throw new Error('Organization not found');
      }

      const [callMetrics, chatMetrics] = await Promise.all([
        callMetricsService.getOrganizationCallMetrics(organizationId, dateRange),
        chatMetricsService.getOrganizationChatMetrics(organizationId, dateRange)
      ]);

      return {
        organizationId: organizationId,
        organizationName: organization.name || 'Unknown',
        callMetrics,
        chatMetrics
      };
    } catch (error: any) {
      logger.error('[Analytics] Error getting detailed organization metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get detailed user metrics (for admin dashboard)
   */
  async getUserMetricsDetailed(
    userId: string,
    dateRange?: DateRange
  ): Promise<UserMetrics> {
    try {
      const user = await User.findById(userId).select('firstName lastName email').lean();
      if (!user) {
        throw new Error('User not found');
      }

      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown';

      const [callMetrics, chatMetrics] = await Promise.all([
        callMetricsService.getUserCallMetrics(userId, dateRange),
        chatMetricsService.getUserChatMetrics(userId, dateRange)
      ]);

      return {
        userId: userId,
        userName,
        callMetrics,
        chatMetrics
      };
    } catch (error: any) {
      logger.error('[Analytics] Error getting detailed user metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get admin metrics (platform-wide)
   */
  async getAdminMetrics(dateRange?: DateRange): Promise<AdminMetrics> {
    try {
      const [platformCallMetrics, platformChatMetrics, organizations] = await Promise.all([
        callMetricsService.getPlatformCallMetrics(dateRange),
        chatMetricsService.getPlatformChatMetrics(dateRange),
        Organization.find().select('_id name').lean()
      ]);

      // Get metrics for each organization
      const byOrganization = await Promise.all(
        organizations.map((org: any) =>
          this.getOrganizationMetricsDetailed(org._id.toString(), dateRange)
        )
      );

      return {
        platformWide: {
          callMetrics: platformCallMetrics,
          chatMetrics: platformChatMetrics
        },
        byOrganization
      };
    } catch (error: any) {
      logger.error('[Analytics] Error getting admin metrics:', error.message);
      throw error;
    }
  }

  /**
   * Get simple metrics (for backward compatibility)
   * Returns: { callMinutes, totalConversations, totalChats }
   */
  async getSimpleMetrics(
    organizationId?: string,
    userId?: string,
    dateRange?: DateRange
  ): Promise<AnalyticsResult> {
    try {
      if (organizationId) {
        return this.getOrganizationMetrics(organizationId, dateRange);
      } else if (userId) {
        return this.getUserMetrics(userId, dateRange);
      } else {
        // Platform-wide
        const [callMetrics, chatMetrics] = await Promise.all([
          callMetricsService.getPlatformCallMetrics(dateRange),
          chatMetricsService.getPlatformChatMetrics(dateRange)
        ]);

        return {
          callMinutes: callMetrics.totalCallMinutes,
          totalConversations: chatMetrics.totalConversations,
          totalChats: chatMetrics.totalChats
        };
      }
    } catch (error: any) {
      logger.error('[Analytics] Error getting simple metrics:', error.message);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();
