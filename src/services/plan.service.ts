import Plan, { IPlan } from '../models/Plan';
import Organization from '../models/Organization';
import User from '../models/User';
import Profile from '../models/Profile';
import { logger } from '../utils/logger.util';
import mongoose from 'mongoose';

export class PlanService {
  /**
   * Create a new plan
   */
  async createPlan(planData: Partial<IPlan>) {
    try {
      const plan = await Plan.create(planData);
      logger.info(`Created plan: ${plan.slug}`);
      return plan;
    } catch (error: any) {
      logger.error('Failed to create plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all plans (active only for users, all for admin)
   */
  async findAllPlans(includeInactive = false) {
    try {
      const query = includeInactive ? {} : { isActive: true };
      const plans = await Plan.find(query).sort({ displayOrder: 1, price: 1 }).lean();
      return plans;
    } catch (error: any) {
      logger.error('Failed to get plans', { error: error.message });
      throw error;
    }
  }

  /**
   * Get plan by ID
   */
  async findPlanById(planId: string) {
    try {
      const plan = await Plan.findById(planId).lean();
      if (!plan) {
        throw new Error('Plan not found');
      }
      return plan;
    } catch (error: any) {
      logger.error('Failed to get plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Get plan by slug
   */
  async getPlanBySlug(slug: string) {
    try {
      const plan = await Plan.findOne({ slug }).lean();
      if (!plan) {
        throw new Error('Plan not found');
      }
      return plan;
    } catch (error: any) {
      logger.error('Failed to get plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Update plan
   */
  async updatePlan(planId: string, planData: Partial<IPlan>) {
    try {
      const plan = await Plan.findByIdAndUpdate(planId, planData, { new: true });
      if (!plan) {
        throw new Error('Plan not found');
      }
      logger.info(`Updated plan: ${plan.slug}`);
      return plan;
    } catch (error: any) {
      logger.error('Failed to update plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete plan (Admin only)
   */
  async deletePlan(planId: string) {
    try {
      // Check if any organizations are using this plan
      const orgsCount = await Organization.countDocuments({ planId: new mongoose.Types.ObjectId(planId) });
      
      if (orgsCount > 0) {
        throw new Error(`Cannot delete plan: ${orgsCount} organization(s) are using it`);
      }

      await Plan.findByIdAndDelete(planId);
      logger.info(`Deleted plan: ${planId}`);
      return { message: 'Plan deleted successfully' };
    } catch (error: any) {
      logger.error('Failed to delete plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Assign plan to organization (or user without organization)
   */
  async assignPlanToOrganization(organizationIdOrUserId: string, planIdOrSlug: string) {
    try {
      // Try to find by ID first, then by slug
      let plan = await Plan.findById(planIdOrSlug);
      if (!plan) {
        plan = await Plan.findOne({ slug: planIdOrSlug });
      }
      
      if (!plan) {
        throw new Error('Plan not found');
      }

      // Try to find organization first
      let organization = await Organization.findById(organizationIdOrUserId);
      
      // If not found, check if it's a user ID and create organization
      if (!organization) {
        const user = await User.findById(organizationIdOrUserId);
        if (user) {
          // User has no organization, create one
          logger.info(`User ${user.email} has no organization, creating one`);
          organization = await Organization.create({
            name: `${user.firstName}'s Organization`,
            ownerId: user._id,
            plan: plan.slug,
            planId: plan._id,
            status: 'active'
          });
          
          // Update user with new organization
          user.organizationId = organization._id as any;
          await user.save();
          
          logger.info(`Created organization ${organization._id} for user ${user.email}`);
        } else {
          throw new Error('Organization or user not found');
        }
      }

      // Update organization with new plan
      organization.plan = plan.slug;
      if (plan._id) {
        organization.planId = plan._id as mongoose.Types.ObjectId;
      }
      await organization.save();

      // Update all users in this organization
      await User.updateMany(
        { organizationId: organization._id },
        { $set: { selectedProfile: plan.slug } }
      );

      // Update all profiles for users in this organization
      const users = await User.find({ organizationId: organization._id }).select('_id').lean();
      const userIds = users.map(u => u._id);

      const now = new Date();
      const billingCycleEnd = new Date(now);
      billingCycleEnd.setMonth(billingCycleEnd.getMonth() + 1);

      // Update or create profiles
      await Promise.all(userIds.map(async (userId) => {
        let profile = await Profile.findOne({ userId });
        
        if (!profile) {
          profile = await Profile.create({
            userId,
            profileType: plan.slug as any,
            chatConversationsLimit: plan.features.chatConversations,
            voiceMinutesLimit: plan.features.callMinutes,
            chatConversationsUsed: 0,
            voiceMinutesUsed: 0,
            billingCycleStart: now,
            billingCycleEnd,
            isActive: true
          });
        } else {
          profile.profileType = plan.slug as any;
          profile.chatConversationsLimit = plan.features.chatConversations;
          profile.voiceMinutesLimit = plan.features.callMinutes;
          // Don't reset usage, just update limits
          profile.billingCycleStart = now;
          profile.billingCycleEnd = billingCycleEnd;
          profile.isActive = true;
          await profile.save();
        }
      }));

      logger.info(`Assigned plan ${plan.slug} to organization ${organization._id}`);
      
      return {
        message: 'Plan assigned successfully',
        organization,
        plan
      };
    } catch (error: any) {
      logger.error('Failed to assign plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Get default plan
   */
  async getDefaultPlan() {
    try {
      let plan = await Plan.findOne({ isDefault: true }).lean();
      
      if (!plan) {
        // If no default, return the cheapest active plan
        plan = await Plan.findOne({ isActive: true }).sort({ price: 1 }).lean();
      }

      return plan;
    } catch (error: any) {
      logger.error('Failed to get default plan', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize default plans if none exist
   */
  async initializeDefaultPlans() {
    try {
      const count = await Plan.countDocuments();
      
      if (count === 0) {
        logger.info('No plans found, creating default plans...');
        
        const defaultPlans = [
          {
            name: 'Free',
            slug: 'free',
            description: 'Perfect for getting started',
            price: 0,
            currency: 'USD',
            features: {
              callMinutes: 100,
              chatConversations: 100,
              automations: 5,
              users: 1,
              customFeatures: ['Basic support', '1 workspace']
            },
            isActive: true,
            isDefault: true,
            displayOrder: 1
          },
          {
            name: 'Starter',
            slug: 'starter',
            description: 'For growing businesses',
            price: 29,
            currency: 'USD',
            features: {
              callMinutes: 500,
              chatConversations: 1000,
              automations: 25,
              users: 5,
              customFeatures: ['Priority support', '5 workspaces', 'Advanced analytics']
            },
            isActive: true,
            isDefault: false,
            displayOrder: 2
          },
          {
            name: 'Professional',
            slug: 'professional',
            description: 'For established teams',
            price: 99,
            currency: 'USD',
            features: {
              callMinutes: 2000,
              chatConversations: 5000,
              automations: 100,
              users: 20,
              customFeatures: ['24/7 support', 'Unlimited workspaces', 'Advanced analytics', 'Custom integrations']
            },
            isActive: true,
            isDefault: false,
            displayOrder: 3
          },
          {
            name: 'Enterprise',
            slug: 'enterprise',
            description: 'For large organizations',
            price: 299,
            currency: 'USD',
            features: {
              callMinutes: -1, // Unlimited
              chatConversations: -1, // Unlimited
              automations: -1, // Unlimited
              users: -1, // Unlimited
              customFeatures: ['Dedicated support', 'Unlimited workspaces', 'Advanced analytics', 'Custom integrations', 'SLA guarantee', 'On-premise option']
            },
            isActive: true,
            isDefault: false,
            displayOrder: 4
          }
        ];

        await Plan.insertMany(defaultPlans);
        logger.info('Default plans created successfully');
      }
    } catch (error: any) {
      logger.error('Failed to initialize default plans', { error: error.message });
      throw error;
    }
  }
}

export const planService = new PlanService();
