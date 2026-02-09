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
      if (!mongoose.Types.ObjectId.isValid(planId)) {
        // If not a valid ID, try finding by slug as a fallback
        const plan = await Plan.findOne({ slug: planId }).lean();
        if (!plan) throw new Error('Plan not found');
        return plan;
      }

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
   * Assign plan to organization (or user's organization)
   */
  async assignPlanToOrganization(orgIdOrUserId: string, planIdOrSlug: string) {
    try {
      // 1. Find Plan
      let plan;
      if (mongoose.Types.ObjectId.isValid(planIdOrSlug)) {
        plan = await Plan.findById(planIdOrSlug);
      }
      if (!plan) {
        plan = await Plan.findOne({ slug: planIdOrSlug });
      }
      if (!plan) throw new Error('Plan not found');

      // 2. Resolve Organization
      let orgId = orgIdOrUserId;
      if (mongoose.Types.ObjectId.isValid(orgIdOrUserId)) {
        const user = await User.findById(orgIdOrUserId);
        if (user && user.organizationId) {
          orgId = user.organizationId.toString();
          // Update user legacy field
          user.selectedProfile = plan.slug;
          await user.save();
        } else if (user) {
          // User has no org?
          throw new Error('User has no organization');
        }
      }

      const org = await Organization.findById(orgId);
      if (!org) throw new Error('Organization not found');

      // 3. Update Organization
      org.plan = plan.slug;
      org.planId = plan._id as mongoose.Types.ObjectId;
      await org.save();

      logger.info(`✅ Assigned plan ${plan.name} to Org ${org._id}`);

      // 4. Ensure Profile (Usage Tracker) exists and reset on upgrade
      let profile = await Profile.findOne({ organizationId: org._id });
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);

      if (!profile) {
        // Create new profile for new organization
        profile = await Profile.create({
          organizationId: org._id,
          billingCycleStart: now,
          billingCycleEnd: end,
          isActive: true,
          // Start fresh with zero usage
          chatConversationsUsed: 0,
          voiceMinutesUsed: 0,
          automationsUsed: 0
        });
        logger.info(`✅ Created new profile for Org ${org._id} with plan ${plan.slug}`);
      } else {
        // Profile exists - this is a plan upgrade/change
        // RESET usage counters and billing cycle (Fresh Start Policy)
        // This ensures users get the full benefit of the new plan immediately
        profile.chatConversationsUsed = 0;
        profile.voiceMinutesUsed = 0;
        profile.automationsUsed = 0;
        profile.billingCycleStart = now;
        profile.billingCycleEnd = end;
        profile.isActive = true; // Ensure profile is active
        await profile.save();
        logger.info(`✅ Reset usage counters and billing cycle for Org ${org._id} on plan upgrade to ${plan.slug}`);
      }

      return {
        message: 'Plan assigned successfully',
        organization: {
          _id: org._id,
          name: org.name,
          plan: org.plan
        },
        plan: {
          _id: plan._id,
          name: plan.name,
          slug: plan.slug
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
      if (count > 0) {
        logger.info('Plans already exist in database. Skipping initialization.');
        return;
      }

      const defaultPlans = [
        {
          name: 'Free Plan',
          slug: 'free',
          description: 'Basic plan for new users',
          price: 0,
          currency: 'EUR',
          features: {
            callMinutes: 100,
            chatConversations: 100,
            automations: 5,
            users: 1,
            customFeatures: []
          },
          isActive: true,
          isDefault: true,
          displayOrder: 0
        },
        {
          name: 'Aistein Pro Pack',
          slug: 'aistein-pro-pack',
          description: '',
          price: 799.00,
          currency: 'EUR',
          features: {
            callMinutes: 2000,
            chatConversations: 5000,
            automations: 100,
            users: 20,
            customFeatures: []
          },
          isActive: true,
          isDefault: false,
          displayOrder: 1
        },
        {
          name: 'Mileva Pack',
          slug: 'mileva-pack',
          description: '',
          price: 299.99,
          currency: 'EUR',
          features: {
            callMinutes: 500,
            chatConversations: 1000,
            automations: 25,
            users: 5,
            customFeatures: []
          },
          isActive: true,
          isDefault: false,
          displayOrder: 2
        },
        {
          name: 'Nobel Pack',
          slug: 'nobel-pack',
          description: '',
          price: 499.00,
          currency: 'EUR',
          features: {
            callMinutes: 1000,
            chatConversations: 2500,
            automations: 50,
            users: 10,
            customFeatures: []
          },
          isActive: true,
          isDefault: false,
          displayOrder: 3
        },
        {
          name: 'Set Up',
          slug: 'set-up',
          description: '',
          price: 699.00,
          currency: 'EUR',
          features: {
            callMinutes: 0,
            chatConversations: 0,
            automations: 0,
            users: 1,
            customFeatures: []
          },
          isActive: true,
          isDefault: false,
          displayOrder: 4
        }
      ];

      logger.info('Bootstrapping initial default plans...');
      await Plan.insertMany(defaultPlans);
      logger.info('✅ Initial plans created successfully');
    } catch (error: any) {
      logger.error('Failed to initialize default plans', { error: error.message });
      throw error;
    }
  }
}

export const planService = new PlanService();
