import Organization from '../models/Organization';
import User from '../models/User';
import Automation from '../models/Automation';
import AutomationExecution from '../models/AutomationExecution';
import GoogleIntegration from '../models/GoogleIntegration';
import SocialIntegration from '../models/SocialIntegration';
import Settings from '../models/Settings';
import Profile, { ProfileType, PROFILE_LIMITS } from '../models/Profile';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import { profileService } from './profile.service';
import { logger } from '../utils/logger.util';
import { analyticsService } from './analytics/analytics.service';
import { usageTrackerService } from './usage/usageTracker.service';
import mongoose from 'mongoose';
import Plan from '../models/Plan';


export class AdminService {
  /**
   * Get dashboard metrics (platform-wide, all-time)
   * Uses centralized analytics service for consistent calculations
   */
  async getDashboardMetrics() {
    try {
      const [
        totalOrganizations,
        activeOrganizations,
        totalUsers,
        totalAutomations,
        activeAutomations,
        totalExecutions,
        failedExecutions,
        googleIntegrations,
        whatsappIntegrations,
        instagramIntegrations,
        facebookIntegrations,
        ecommerceIntegrations,
        platformMetrics
      ] = await Promise.all([
        Organization.countDocuments().lean(),
        Organization.countDocuments({ status: 'active' }).lean(),
        User.countDocuments({ status: 'active' }).lean(),
        Automation.countDocuments().lean(),
        Automation.countDocuments({ isActive: true }).lean(),
        AutomationExecution.countDocuments().lean(),
        AutomationExecution.countDocuments({ status: 'failed' }).lean(),
        GoogleIntegration.countDocuments({ status: 'active' }).lean(),
        SocialIntegration.countDocuments({
          platform: 'whatsapp',
          status: 'connected'
        }).lean(),
        SocialIntegration.countDocuments({
          platform: 'instagram',
          status: 'connected'
        }).lean(),
        SocialIntegration.countDocuments({
          platform: 'facebook',
          status: 'connected'
        }).lean(),
        Settings.countDocuments({ 'ecommerceIntegration.platform': { $exists: true, $ne: null } }).lean(),
        analyticsService.getSimpleMetrics() // All-time metrics using centralized service
      ]);

      return {
        totalOrganizations,
        activeOrganizations,
        totalUsers,
        totalAutomations,
        activeAutomations,
        totalExecutions,
        failedExecutions,
        googleIntegrations,
        whatsappIntegrations,
        instagramIntegrations,
        facebookIntegrations,
        ecommerceIntegrations,
        totalCallMinutes: platformMetrics.callMinutes,
        totalChatConversations: platformMetrics.totalConversations
      };
    } catch (error: any) {
      logger.error('Failed to get dashboard metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all automations across all organizations
   */
  async getAllAutomations(page = 1, limit = 20, filters: any = {}) {
    try {
      const query: any = {};

      if (filters.organizationId) {
        query.organizationId = filters.organizationId;
      }

      if (filters.status) {
        if (filters.status === 'active') {
          query.isActive = true;
        } else if (filters.status === 'inactive') {
          query.isActive = false;
        }
      }

      if (filters.search) {
        query.name = { $regex: filters.search, $options: 'i' };
      }

      const skip = (page - 1) * limit;
      const [automations, total] = await Promise.all([
        Automation.find(query)
          .populate('organizationId', 'name slug')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Automation.countDocuments(query)
      ]);

      const automationsWithDetails = automations.map((automation: any) => {
        const organization = automation.organizationId as any;
        const nodes = automation.nodes || [];
        const triggerNode = nodes.find((n: any) => n.type === 'trigger');
        const actionNodes = nodes.filter((n: any) => n.type === 'action');

        return {
          _id: automation._id,
          name: automation.name,
          description: automation.description || '',
          organizationId: organization ? {
            _id: organization._id,
            name: organization.name,
            slug: organization.slug
          } : null,
          isActive: automation.isActive,
          nodeCount: nodes.length,
          triggerType: triggerNode?.serviceId || 'unknown',
          lastExecutedAt: automation.lastExecutedAt || null,
          executionCount: automation.executionCount || 0,
          createdAt: automation.createdAt,
          updatedAt: automation.updatedAt,
          // Include full automation data for viewing
          nodes: nodes,
          edges: automation.edges || []
        };
      });

      return {
        items: automationsWithDetails,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      };
    } catch (error: any) {
      logger.error('Failed to get all automations', { error: error.message });
      throw error;
    }
  }

  /**
   * Get automation by ID
   */
  async getAutomationById(automationId: string) {
    try {
      const automation = await Automation.findById(automationId)
        .populate('organizationId', 'name slug')
        .lean();

      if (!automation) {
        throw new Error('Automation not found');
      }

      return automation;
    } catch (error: any) {
      logger.error('Failed to get automation by ID', { error: error.message });
      throw error;
    }
  }

  /**
   * Toggle automation status
   */
  async toggleAutomation(automationId: string, isActive: boolean) {
    try {
      const automation = await Automation.findByIdAndUpdate(
        automationId,
        { isActive },
        { new: true }
      );

      if (!automation) {
        throw new Error('Automation not found');
      }

      return automation;
    } catch (error: any) {
      logger.error('Failed to toggle automation', { error: error.message });
      throw error;
    }
  }

  /**
   * Get execution logs with filters
   */
  async getExecutionLogs(page = 1, limit = 20, filters: any = {}) {
    try {
      const query: any = {};

      if (filters.organizationId) {
        query.organizationId = filters.organizationId;
      }

      if (filters.automationId) {
        query.automationId = filters.automationId;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
      }

      const skip = (page - 1) * limit;
      const [executions, total] = await Promise.all([
        AutomationExecution.find(query)
          .populate({
            path: 'automationId',
            select: 'name organizationId',
            populate: {
              path: 'organizationId',
              select: 'name slug',
              model: 'Organization'
            }
          })
          .sort({ executedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AutomationExecution.countDocuments(query)
      ]);

      const executionsWithDetails = executions.map((execution: any) => {
        // Handle null/undefined automationId (if automation was deleted)
        const automation = execution.automationId as any;
        const organization = automation?.organizationId as any;

        // Safely extract automation info
        const automationInfo = automation && automation._id ? {
          _id: automation._id?.toString() || automation._id,
          name: automation.name || 'Unknown Automation'
        } : null;

        // Safely extract organization info
        const organizationInfo = organization && organization._id ? {
          _id: organization._id?.toString() || organization._id,
          name: organization.name || 'Unknown Organization',
          slug: organization.slug || ''
        } : null;

        return {
          _id: execution._id?.toString() || execution._id,
          automationId: automationInfo,
          automation: automationInfo,
          organizationId: organizationInfo,
          organization: organizationInfo,
          status: execution.status || 'pending',
          triggerData: execution.triggerData || {},
          actionResults: (execution as any).actionResults || [],
          actionData: execution.actionData || [],
          error: (execution as any).error || execution.errorMessage || null,
          errorMessage: execution.errorMessage || (execution as any).error || null,
          executedAt: execution.executedAt || (execution as any).createdAt,
          createdAt: (execution as any).createdAt,
          completedAt: (execution as any).completedAt
        };
      });

      return {
        items: executionsWithDetails,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      };
    } catch (error: any) {
      logger.error('Failed to get execution logs', { error: error.message });
      throw error;
    }
  }

  /**
   * Get execution by ID
   */
  async getExecutionById(executionId: string) {
    try {
      const execution = await AutomationExecution.findById(executionId)
        .populate({
          path: 'automationId',
          select: 'name organizationId',
          populate: {
            path: 'organizationId',
            select: 'name slug',
            model: 'Organization'
          }
        })
        .lean();

      if (!execution) {
        throw new Error('Execution not found');
      }

      // Format execution similar to getExecutionLogs
      const automation = execution.automationId as any;
      const organization = automation?.organizationId as any;

      return {
        _id: execution._id?.toString() || execution._id,
        automationId: automation && automation._id ? {
          _id: automation._id?.toString() || automation._id,
          name: automation.name || 'Unknown Automation'
        } : null,
        automation: automation && automation._id ? {
          _id: automation._id?.toString() || automation._id,
          name: automation.name || 'Unknown Automation'
        } : null,
        organizationId: organization && organization._id ? {
          _id: organization._id?.toString() || organization._id,
          name: organization.name || 'Unknown Organization',
          slug: organization.slug || ''
        } : null,
        organization: organization && organization._id ? {
          _id: organization._id?.toString() || organization._id,
          name: organization.name || 'Unknown Organization',
          slug: organization.slug || ''
        } : null,
        status: execution.status || 'pending',
        triggerData: execution.triggerData || {},
        actionResults: (execution as any).actionResults || [],
        actionData: execution.actionData || [],
        error: (execution as any).error || execution.errorMessage || null,
        errorMessage: execution.errorMessage || (execution as any).error || null,
        executedAt: execution.executedAt || (execution as any).createdAt,
        createdAt: (execution as any).createdAt,
        completedAt: (execution as any).completedAt
      };
    } catch (error: any) {
      logger.error('Failed to get execution by ID', { error: error.message });
      throw error;
    }
  }

  /**
   * Re-run execution
   */
  async rerunExecution(executionId: string) {
    try {
      const execution = await AutomationExecution.findById(executionId)
        .populate('automationId');

      if (!execution) {
        throw new Error('Execution not found');
      }

      const automation = execution.automationId as any;
      if (!automation || !automation.isActive) {
        throw new Error('Automation not found or inactive');
      }

      // Import automation engine and trigger execution
      const { AutomationEngine } = await import('./automationEngine.service');
      const engine = new AutomationEngine();

      // Get organizationId from automation
      const automationDoc = await Automation.findById(automation._id).select('organizationId').lean();
      const organizationId = automationDoc?.organizationId?.toString() || '';

      await engine.executeAutomation(
        automation._id.toString(),
        execution.triggerData || {},
        organizationId
      );

      return { message: 'Execution queued for retry', executionId };
    } catch (error: any) {
      logger.error('Failed to rerun execution', { error: error.message });
      throw error;
    }
  }

  /**
   * Get integrations status for all organizations
   */
  async getIntegrationsStatus() {
    try {
      const organizations = await Organization.find().lean();

      const statusByOrg = await Promise.all(
        organizations.map(async (org: any) => {
          // Google Integration
          const googleIntegration = await GoogleIntegration.findOne({
            organizationId: org._id,
            status: 'active'
          }).lean();

          // WhatsApp Integration
          const whatsappIntegration = await SocialIntegration.findOne({
            organizationId: org._id,
            platform: 'whatsapp',
            status: 'connected'
          }).lean();

          // Instagram Integration
          const instagramIntegration = await SocialIntegration.findOne({
            organizationId: org._id,
            platform: 'instagram',
            status: 'connected'
          }).lean();

          // Facebook Integration
          const facebookIntegration = await SocialIntegration.findOne({
            organizationId: org._id,
            platform: 'facebook',
            status: 'connected'
          }).lean();

          // E-commerce Integration
          const orgUsers = await User.find({ organizationId: org._id }).select('_id').lean();
          const userIds = orgUsers.map(u => u._id);
          const ecommerceSettings = await Settings.findOne({
            userId: { $in: userIds },
            'ecommerceIntegration.platform': { $exists: true, $ne: null }
          }).lean();

          return {
            organization: {
              id: org._id?.toString() || org._id,
              name: org.name || 'Unknown Organization',
              slug: org.slug || ''
            },
            google: {
              connected: !!googleIntegration,
              services: googleIntegration ? {
                gmail: googleIntegration.services?.gmail || false,
                sheets: googleIntegration.services?.sheets || false,
                calendar: googleIntegration.services?.calendar || false,
                drive: googleIntegration.services?.drive || false
              } : null,
              tokenExpiry: googleIntegration?.tokenExpiry || null,
              lastError: null // GoogleIntegration doesn't track lastError
            },
            whatsapp: {
              connected: !!whatsappIntegration,
              webhookVerified: whatsappIntegration?.webhookVerified || false,
              lastError: whatsappIntegration?.errorMessage || null
            },
            instagram: {
              connected: !!instagramIntegration,
              webhookVerified: instagramIntegration?.webhookVerified || false,
              lastError: instagramIntegration?.errorMessage || null
            },
            facebook: {
              connected: !!facebookIntegration,
              webhookVerified: facebookIntegration?.webhookVerified || false,
              lastError: facebookIntegration?.errorMessage || null
            },
            ecommerce: {
              connected: !!ecommerceSettings?.ecommerceIntegration?.platform,
              platform: ecommerceSettings?.ecommerceIntegration?.platform || null,
              lastSync: null, // Not tracked in current schema
              enabledTriggers: 0 // Not tracked in current schema
            }
          };
        })
      );

      return statusByOrg;
    } catch (error: any) {
      logger.error('Failed to get integrations status', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all organizations with usage analytics
   */
  async getOrganizations(filters: any = {}) {
    try {
      const query: any = {};

      if (filters.plan) {
        query.plan = filters.plan;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const organizations = await Organization.find(query)
        .populate('ownerId', 'email firstName lastName')
        .populate('planId') // Populate plan details
        .sort({ createdAt: -1 })
        .lean();

      const organizationsWithUsage = await Promise.all(
        organizations.map(async (org: any) => {
          try {
            // Get users in this organization
            const orgUsers = await User.find({ organizationId: org._id }).select('_id').lean();
            const userIds = orgUsers.map(u => u._id);

            // Get REAL-TIME usage from centralized usage tracker (with error handling)
            let usage = {
              callMinutes: 0,
              chatMessages: 0,
              conversations: 0,
              automations: 0,
              campaignSends: 0
            };

            try {
              usage = await usageTrackerService.getOrganizationUsage(org._id.toString());
            } catch (usageError: any) {
              logger.warn(`Could not get usage for org ${org._id}:`, usageError.message);
            }

            // Get integrations status (only show CONNECTED integrations)
            const [googleIntegration, whatsappIntegration, instagramIntegration, facebookIntegration, ecommerceSettings] = await Promise.all([
              GoogleIntegration.findOne({ organizationId: org._id, status: 'active' }).lean(),
              SocialIntegration.findOne({ organizationId: org._id, platform: 'whatsapp', status: 'connected' }).lean(),
              SocialIntegration.findOne({ organizationId: org._id, platform: 'instagram', status: 'connected' }).lean(),
              SocialIntegration.findOne({ organizationId: org._id, platform: 'facebook', status: 'connected' }).lean(),
              Settings.findOne({ userId: { $in: userIds }, 'ecommerceIntegration.platform': { $exists: true } }).lean()
            ]);

            return {
              ...org,
              usage: {
                callMinutes: usage.callMinutes || 0,
                chatMessages: usage.chatMessages || 0,
                conversations: usage.conversations || 0,
                automations: usage.automations || 0
              },
              integrations: {
                google: !!googleIntegration,
                whatsapp: !!whatsappIntegration,
                instagram: !!instagramIntegration,
                facebook: !!facebookIntegration,
                ecommerce: {
                  connected: !!ecommerceSettings?.ecommerceIntegration?.platform,
                  platform: ecommerceSettings?.ecommerceIntegration?.platform || null
                }
              },
              integrationCount: {
                google: googleIntegration ? 1 : 0,
                whatsapp: whatsappIntegration ? 1 : 0,
                instagram: instagramIntegration ? 1 : 0,
                facebook: facebookIntegration ? 1 : 0,
                ecommerce: ecommerceSettings?.ecommerceIntegration?.platform ? 1 : 0
              },
              planDetails: org.planId || {
                name: org.plan || 'free',
                slug: org.plan || 'free',
                price: 0,
                features: {
                  callMinutes: 100,
                  chatConversations: 100,
                  automations: 5,
                  users: 1,
                  customFeatures: []
                }
              }
            };
          } catch (error: any) {
            logger.error(`Error processing organization ${org._id}:`, error.message);
            // Return organization with default values on error
            return {
              ...org,
              usage: { callMinutes: 0, chatMessages: 0, conversations: 0, automations: 0 },
              integrations: { google: false, whatsapp: false, instagram: false, facebook: false, ecommerce: { connected: false, platform: null } },
              integrationCount: { google: 0, whatsapp: 0, instagram: 0, facebook: 0, ecommerce: 0 },
              planDetails: { name: 'free', slug: 'free', price: 0, features: { callMinutes: 100, chatConversations: 100, automations: 5, users: 1, customFeatures: [] } }
            };
          }
        })
      );

      return organizationsWithUsage;
    } catch (error: any) {
      logger.error('Failed to get organizations', { error: error.message });
      throw error;
    }
  }

  /**
   * Get organization usage analytics
   */
  async getOrganizationUsage(organizationId?: string, dateRange?: { from?: Date; to?: Date }) {
    try {
      const query: any = {};
      if (organizationId) {
        query._id = organizationId;
      }

      // Get organizations
      const orgs = await Organization.find(query).lean();

      const usageData = await Promise.all(
        orgs.map(async (org: any) => {
          const orgUsers = await User.find({ organizationId: org._id }).select('_id').lean();
          const userIds = orgUsers.map(u => u._id);

          // Get profile usage
          const profileUsage = await Profile.aggregate([
            { $match: { userId: { $in: userIds }, isActive: true } },
            {
              $group: {
                _id: null,
                totalCallMinutes: { $sum: '$voiceMinutesUsed' },
                totalChatConversations: { $sum: '$chatConversationsUsed' }
              }
            }
          ]);

          const usage = profileUsage[0] || { totalCallMinutes: 0, totalChatConversations: 0 };

          // Get automation count
          const automationCount = await Automation.countDocuments({ organizationId: org._id });

          return {
            organizationId: org._id,
            organizationName: org.name,
            callMinutes: usage.totalCallMinutes || 0,
            chatConversations: usage.totalChatConversations || 0,
            automations: automationCount
          };
        })
      );

      return usageData;
    } catch (error: any) {
      logger.error('Failed to get organization usage', { error: error.message });
      throw error;
    }
  }

  /**
   * Get user details with profile and usage information
   */
  async getUserDetails(userId: string) {
    try {
      const user = await User.findById(userId)
        .populate('organizationId', 'name slug plan status')
        .lean();

      if (!user) {
        throw new Error('User not found');
      }

      const profile = await Profile.findOne({ userId }).lean();
      const organization = user.organizationId as any;

      return {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
          selectedProfile: user.selectedProfile,
          organizationId: user.organizationId
        },
        organization: organization ? {
          _id: organization._id,
          name: organization.name,
          slug: organization.slug,
          plan: organization.plan,
          status: organization.status
        } : null,
        profile: profile ? {
          profileType: profile.profileType,
          chatConversationsLimit: profile.chatConversationsLimit,
          voiceMinutesLimit: profile.voiceMinutesLimit,
          chatConversationsUsed: profile.chatConversationsUsed,
          voiceMinutesUsed: profile.voiceMinutesUsed,
          billingCycleStart: profile.billingCycleStart,
          billingCycleEnd: profile.billingCycleEnd,
          isActive: profile.isActive
        } : null
      };
    } catch (error: any) {
      logger.error('Failed to get user details', { error: error.message });
      throw error;
    }
  }

  /**
   * Upgrade user billing plan (profile and organization plan)
   */
  async upgradeUserPlan(
    userId: string,
    profileType: ProfileType,
    organizationPlan?: 'mileva-pack' | 'nobel-pack' | 'aistein-pro-pack' | 'set-up'
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Update user's selected profile
      user.selectedProfile = profileType;
      await user.save();

      // Update or create profile with new limits
      const limits = PROFILE_LIMITS[profileType];
      if (!limits) {
        throw new Error('Invalid profile type');
      }

      let profile = await Profile.findOne({ userId });
      const now = new Date();
      const billingCycleEnd = new Date(now);
      billingCycleEnd.setMonth(billingCycleEnd.getMonth() + 1);

      if (!profile) {
        // Create new profile
        profile = await Profile.create({
          userId,
          profileType,
          chatConversationsLimit: limits.chatConversations,
          voiceMinutesLimit: limits.voiceMinutes,
          automationsLimit: (limits as any).automations || 5,
          chatConversationsUsed: 0,
          voiceMinutesUsed: 0,
          automationsUsed: 0,
          billingCycleStart: now,
          billingCycleEnd,
          isActive: true
        });
      } else {
        // Update existing profile with new limits
        const oldLimit = profile.chatConversationsLimit;
        const oldVoiceLimit = profile.voiceMinutesLimit;
        profile.profileType = profileType;
        profile.chatConversationsLimit = limits.chatConversations;
        profile.voiceMinutesLimit = limits.voiceMinutes;
        profile.automationsLimit = (limits as any).automations || 5;

        if (limits.chatConversations < oldLimit) {
          profile.chatConversationsUsed = Math.min(
            profile.chatConversationsUsed,
            limits.chatConversations
          );
        }
        if (limits.voiceMinutes < oldVoiceLimit) {
          profile.voiceMinutesUsed = Math.min(
            profile.voiceMinutesUsed,
            limits.voiceMinutes
          );
        }
        profile.billingCycleStart = now;
        profile.billingCycleEnd = billingCycleEnd;
        profile.isActive = true;
        await profile.save();
      }

      // Update organization plan if user is an owner or has organizationId
      if (user.organizationId) {
        const organization = await Organization.findById(user.organizationId);
        if (organization) {
          // Sync organization plan with profileType
          organization.plan = profileType;

          // Also set planId if matching Plan found
          const matchingPlan = await Plan.findOne({ slug: profileType }).lean();
          if (matchingPlan) {
            organization.planId = matchingPlan._id as mongoose.Types.ObjectId;
          }
          await organization.save();
          logger.info(`✅ Updated organization ${organization._id} plan to ${profileType}`);
        }
      }

      logger.info(
        `✅ Upgraded user ${userId} to profile ${profileType}`
      );

      return {
        user: {
          _id: user._id,
          email: user.email,
          selectedProfile: user.selectedProfile
        },
        profile: {
          profileType: profile.profileType,
          chatConversationsLimit: profile.chatConversationsLimit,
          voiceMinutesLimit: profile.voiceMinutesLimit,
          automationsLimit: profile.automationsLimit,
          chatConversationsUsed: profile.chatConversationsUsed,
          voiceMinutesUsed: profile.voiceMinutesUsed,
          automationsUsed: profile.automationsUsed,
          billingCycleStart: profile.billingCycleStart,
          billingCycleEnd: profile.billingCycleEnd
        }
      };
    } catch (error: any) {
      logger.error('Failed to upgrade user plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all users with their profile and usage information
   */
  async getAllUsers(filters: any = {}) {
    try {
      const query: any = {};

      if (filters.role) {
        query.role = filters.role;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.search) {
        query.$or = [
          { email: { $regex: filters.search, $options: 'i' } },
          { firstName: { $regex: filters.search, $options: 'i' } },
          { lastName: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const users = await User.find(query)
        .populate('organizationId', 'name slug plan status')
        .sort({ createdAt: -1 })
        .lean();

      const usersWithProfile = await Promise.all(
        users.map(async (user: any) => {
          const profile = await Profile.findOne({ userId: user._id }).lean();
          const organization = user.organizationId as any;

          return {
            _id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            status: user.status,
            selectedProfile: user.selectedProfile,
            organization: organization ? {
              _id: organization._id,
              name: organization.name,
              slug: organization.slug,
              plan: organization.plan,
              status: organization.status
            } : null,
            profile: profile ? {
              profileType: profile.profileType,
              chatConversationsLimit: profile.chatConversationsLimit,
              voiceMinutesLimit: profile.voiceMinutesLimit,
              chatConversationsUsed: profile.chatConversationsUsed,
              voiceMinutesUsed: profile.voiceMinutesUsed,
              billingCycleStart: profile.billingCycleStart,
              billingCycleEnd: profile.billingCycleEnd,
              isActive: profile.isActive,
              usagePercentage: {
                chat: Math.round((profile.chatConversationsUsed / profile.chatConversationsLimit) * 100),
                voice: Math.round((profile.voiceMinutesUsed / profile.voiceMinutesLimit) * 100)
              }
            } : null
          };
        })
      );

      return usersWithProfile;
    } catch (error: any) {
      logger.error('Failed to get all users', { error: error.message });
      throw error;
    }
  }

  /**
   * Get platform usage analytics
   */
  async getUsageReports(dateFrom?: string, dateTo?: string) {
    try {
      const dateQuery: any = {};
      if (dateFrom || dateTo) {
        dateQuery.createdAt = {};
        if (dateFrom) dateQuery.createdAt.$gte = new Date(dateFrom);
        if (dateTo) dateQuery.createdAt.$lte = new Date(dateTo);
      }

      // Total conversations by channel
      const conversationsByChannel = await Conversation.aggregate([
        { $match: dateQuery },
        {
          $project: {
            channel: {
              $cond: {
                if: { $eq: ['$channel', 'social'] },
                then: {
                  $cond: {
                    if: { $eq: ['$metadata.platform', 'instagram'] },
                    then: 'instagram',
                    else: {
                      $cond: {
                        if: { $eq: ['$metadata.platform', 'facebook'] },
                        then: 'facebook',
                        else: 'social'
                      }
                    }
                  }
                },
                else: '$channel'
              }
            }
          }
        },
        { $group: { _id: '$channel', count: { $sum: 1 } } }
      ]);

      // Use centralized analytics service
      const dateRange = dateFrom || dateTo ? {
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined
      } : undefined;

      const platformMetrics = await analyticsService.getSimpleMetrics(undefined, undefined, dateRange);

      // Usage by organization using centralized service
      const organizations = await Organization.find().lean();
      const usageByOrganization = await Promise.all(
        organizations.map(async (org: any) => {
          const orgUsers = await User.find({ organizationId: org._id }).select('_id').lean();
          const orgMetrics = await analyticsService.getOrganizationMetrics(org._id.toString(), dateRange);

          return {
            _id: org._id,
            name: org.name,
            totalCallMinutes: orgMetrics.callMinutes,
            totalChatConversations: orgMetrics.totalConversations,
            userCount: orgUsers.length
          };
        })
      );

      return {
        conversationsByChannel: conversationsByChannel.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        totalCallMinutes: platformMetrics.callMinutes,
        totalChatConversations: platformMetrics.totalConversations,
        usageByOrganization
      };
    } catch (error: any) {
      logger.error('Failed to get usage reports', { error: error.message });
      throw error;
    }
  }

  /**
   * Get billing overview (revenue & subscriptions)
   */
  async getBillingOverview() {
    try {
      // 1. Get all plans to understand pricing and slugs
      const plans = await Plan.find().lean();
      const planMap = plans.reduce((acc, plan) => {
        acc[plan.slug] = plan;
        return acc;
      }, {} as Record<string, any>);

      // 2. Get all active profiles (subscriptions)
      // This is the source of truth for paid/active plans
      const activeProfiles = await Profile.find({ isActive: true }).lean();

      // Count profiles by type to get accurate plan distribution
      const profileBreakdown = activeProfiles.reduce((acc, profile) => {
        // Only count if it's a known plan
        if (planMap[profile.profileType]) {
          acc[profile.profileType] = (acc[profile.profileType] || 0) + 1;
        } else {
          // Fallback or legacy plans
          acc[profile.profileType] = (acc[profile.profileType] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      // 3. Get all organizations
      const organizations = await Organization.find().lean();

      // 4. Map organizations to their billing status based on OWNER's profile
      const organizationsWithBilling = await Promise.all(
        organizations.map(async (org: any) => {
          // Find the owner of the organization
          const owner = await User.findOne({ organizationId: org._id, role: 'admin' }).lean(); // Assuming admin is owner or using org.ownerId if exists

          let ownerProfile = null;
          if (org.ownerId) {
            ownerProfile = await Profile.findOne({ userId: org.ownerId }).lean();
          } else if (owner) {
            ownerProfile = await Profile.findOne({ userId: owner._id }).lean();
          }

          // Determine the effective plan for the organization
          const effectivePlanSlug = ownerProfile?.profileType || org.plan || 'free';
          const effectivePlan = planMap[effectivePlanSlug];

          return {
            _id: org._id,
            name: org.name,
            plan: effectivePlanSlug, // Use the profile type as the plan
            status: org.status,
            price: effectivePlan?.price || 0,
            ownerProfile: ownerProfile ? {
              profileType: ownerProfile.profileType,
              billingCycleStart: ownerProfile.billingCycleStart,
              billingCycleEnd: ownerProfile.billingCycleEnd,
              isActive: ownerProfile.isActive
            } : null,
            createdAt: org.createdAt
          };
        })
      );

      // Re-calculate plan breakdown based on organizations to ensure alignment with frontend expectations
      // (User asked for "real time data if i change there it should refelect here")
      // If the frontend sums up organizations, we should make sure the breakdown matches.
      // Actually, profiles (users) pay, not organizations directly in this model?
      // "Assign plan to individual user" -> So we should count PROFILES.
      // But frontend shows "Total Organizations" and "Revenue by Plan" (x orgs).
      // If multiple users in one org have plans, it might be confusing.
      // Assuming 1 Plan per Org (Owner's plan).

      const orgPlanBreakdown = organizationsWithBilling.reduce((acc, org) => {
        acc[org.plan] = (acc[org.plan] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        planBreakdown: orgPlanBreakdown, // Using org-based breakdown for consistency with "Revenue by Plan" cards
        profileBreakdown, // Keep this for detailed stats if needed
        totalOrganizations: organizations.length,
        activeSubscriptions: activeProfiles.length,
        organizationsWithBilling
      };
    } catch (error: any) {
      logger.error('Failed to get billing overview', { error: error.message });
      throw error;
    }
  }

  /**
   * Get system settings
   */
  async getSystemSettings() {
    try {
      // Return system-wide settings (can be extended)
      return {
        platformName: 'Aistein',
        version: '1.0.0',
        maintenanceMode: false,
        features: {
          automations: true,
          voiceAgent: true,
          whatsapp: true,
          instagram: true,
          facebook: true,
          googleWorkspace: true,
          ecommerce: true
        }
      };
    } catch (error: any) {
      logger.error('Failed to get system settings', { error: error.message });
      throw error;
    }
  }

  /**
   * Update system settings
   */
  async updateSystemSettings(settings: any) {
    try {
      // In a real system, this would update a SystemSettings collection
      // For now, we'll just log it
      logger.info('System settings updated', { settings });
      return { success: true, message: 'System settings updated' };
    } catch (error: any) {
      logger.error('Failed to update system settings', { error: error.message });
      throw error;
    }
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(filters: any = {}) {
    try {
      const query: any = {};

      if (filters.action) {
        query.action = filters.action;
      }

      if (filters.userId) {
        query.userId = filters.userId;
      }

      if (filters.dateFrom || filters.dateTo) {
        query.timestamp = {};
        if (filters.dateFrom) query.timestamp.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.timestamp.$lte = new Date(filters.dateTo);
      }

      // In a real system, this would query an AuditLog collection
      // For now, return mock data structure
      return {
        logs: [],
        total: 0,
        page: filters.page || 1,
        limit: filters.limit || 50
      };
    } catch (error: any) {
      logger.error('Failed to get audit logs', { error: error.message });
      throw error;
    }
  }

  /**
   * Get system alerts
   */
  async getSystemAlerts() {
    try {
      // Check for various system issues
      const alerts: any[] = [];

      // Check for failed automation executions
      const recentFailedExecutions = await AutomationExecution.countDocuments({
        status: 'failed',
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      });

      if (recentFailedExecutions > 10) {
        alerts.push({
          type: 'warning',
          severity: 'medium',
          title: 'High Failure Rate',
          message: `${recentFailedExecutions} automation executions failed in the last 24 hours`,
          timestamp: new Date()
        });
      }

      // Check for organizations with expired plans
      const organizationsWithExpiredProfiles = await Organization.aggregate([
        {
          $lookup: {
            from: 'profiles',
            localField: 'ownerId',
            foreignField: 'userId',
            as: 'profiles'
          }
        },
        {
          $match: {
            'profiles.billingCycleEnd': { $lt: new Date() },
            'profiles.isActive': true
          }
        }
      ]);

      if (organizationsWithExpiredProfiles.length > 0) {
        alerts.push({
          type: 'info',
          severity: 'low',
          title: 'Expired Subscriptions',
          message: `${organizationsWithExpiredProfiles.length} organization(s) have expired billing cycles`,
          timestamp: new Date()
        });
      }

      return {
        alerts,
        total: alerts.length
      };
    } catch (error: any) {
      logger.error('Failed to get system alerts', { error: error.message });
      throw error;
    }
  }
}
