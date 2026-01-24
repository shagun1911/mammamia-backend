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
   * Assign plan to individual user (user-based system)
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

      // Find the specific user (NOT organization)
      const user = await User.findById(organizationIdOrUserId);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Update ONLY this user's plan (not all users)
      user.selectedProfile = plan.slug;
      await user.save();

      logger.info(`✅ Assigned plan ${plan.name} to user ${user.email} ONLY`);

      // Update or create profile for THIS USER ONLY

      const now = new Date();
      const billingCycleEnd = new Date(now);
      billingCycleEnd.setMonth(billingCycleEnd.getMonth() + 1);

      // Update or create profile for THIS USER ONLY
      let profile = await Profile.findOne({ userId: user._id });
      
      if (!profile) {
        profile = await Profile.create({
          userId: user._id,
          profileType: plan.slug as any,
          chatConversationsLimit: plan.features.chatConversations,
          voiceMinutesLimit: plan.features.callMinutes,
          chatConversationsUsed: 0,
          voiceMinutesUsed: 0,
          billingCycleStart: now,
          billingCycleEnd,
          isActive: true
        });
        logger.info(`✅ Created new profile for ${user.email}`);
      } else {
        profile.profileType = plan.slug as any;
        profile.chatConversationsLimit = plan.features.chatConversations;
        profile.voiceMinutesLimit = plan.features.callMinutes;
        profile.billingCycleStart = now;
        profile.billingCycleEnd = billingCycleEnd;
        profile.isActive = true;
        await profile.save();
        logger.info(`✅ Updated profile for ${user.email}`);
      }
      
      return {
        message: 'Plan assigned successfully to individual user',
        user: {
          _id: user._id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          plan: user.selectedProfile
        },
        plan: {
          _id: plan._id,
          name: plan.name,
          slug: plan.slug,
          features: plan.features
        },
        profile: {
          _id: profile._id,
          limits: {
            calls: profile.voiceMinutesLimit,
            chats: profile.chatConversationsLimit
          }
        }
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
            name: 'Aistein Pro Pack',
            slug: 'aistein-pro-pack',
            description: 'Voice and Chat Artificial Intelligence Agents',
            price: 799.00,
            currency: 'EUR',
            features: {
              callMinutes: 2000,
              chatConversations: 5000,
              automations: 100,
              users: 20,
              customFeatures: ['Voice and Chat AI Agents', '1 month duration']
            },
            isActive: true,
            isDefault: false,
            displayOrder: 1
          },
          {
            name: 'Mileva Pack',
            slug: 'mileva-pack',
            description: 'Voice and Chat Artificial Intelligence Agents',
            price: 299.99,
            currency: 'EUR',
            features: {
              callMinutes: 500,
              chatConversations: 1000,
              automations: 25,
              users: 5,
              customFeatures: ['Voice and Chat AI Agents', '1 month duration']
            },
            isActive: true,
            isDefault: true,
            displayOrder: 2
          },
          {
            name: 'Nobel Pack',
            slug: 'nobel-pack',
            description: 'Voice and Chat Artificial Intelligence Agents',
            price: 499.00,
            currency: 'EUR',
            features: {
              callMinutes: 1000,
              chatConversations: 2500,
              automations: 50,
              users: 10,
              customFeatures: ['Voice and Chat AI Agents', '1 month duration']
            },
            isActive: true,
            isDefault: false,
            displayOrder: 3
          },
          {
            name: 'Set Up',
            slug: 'set-up',
            description: 'Voice and Chat Artificial Intelligence Agents',
            price: 699.00,
            currency: 'EUR',
            features: {
              callMinutes: 0,
              chatConversations: 0,
              automations: 0,
              users: 1,
              customFeatures: ['Setup Service', 'One-time fee']
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
