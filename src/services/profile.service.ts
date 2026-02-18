import Profile, { IProfile } from '../models/Profile';
import User from '../models/User';
import Organization from '../models/Organization';
import Plan from '../models/Plan';
import Automation from '../models/Automation';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';
import { usageTrackerService } from './usage/usageTracker.service';

export class ProfileService {

  /**
   * Helper: Resolve Organization ID from various inputs
   */
  private async resolveOrganizationId(input: string | mongoose.Types.ObjectId): Promise<string> {
    if (mongoose.isValidObjectId(input)) {
      // Check if it's a user first
      const user = await User.findById(input).select('organizationId');
      if (user) {
        if (user.organizationId) return user.organizationId.toString();
        // User exists but has no organization — do not treat userId as orgId
        return '';
      }
      // Not a user ID, assume it's organizationId
      return input.toString();
    }
    return input.toString();
  }

  /**
   * Ensure user has an organization; create and link one if missing.
   * Returns organization ID for the user (existing or newly created).
   * When creating a new org, migrates resources that used userId as organizationId.
   */
  async ensureOrganizationForUser(userId: string): Promise<string> {
    const user = await User.findById(userId).select('organizationId firstName companyName');
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (user.organizationId) return user.organizationId.toString();

    const freePlan = await Plan.findOne({ slug: 'free' });
    const orgName = (user as any).companyName || ((user as any).firstName ? `${(user as any).firstName}'s Organization` : 'My Organization');
    const slug = `org-${userId.slice(-8)}-${Date.now()}`;
    const org = await Organization.create({
      name: orgName,
      slug,
      status: 'active',
      plan: 'free',
      planId: freePlan?._id,
      ownerId: user._id
    });
    user.organizationId = org._id as mongoose.Types.ObjectId;
    await user.save();

    const userObjectId = new mongoose.Types.ObjectId(userId);
    await Automation.updateMany(
      { organizationId: userObjectId },
      { $set: { organizationId: org._id } }
    );

    return org._id.toString();
  }

  /**
   * Get usage profile for an organization
   */
  async get(orgIdOrUserId: string): Promise<IProfile | null> {
    const orgId = await this.resolveOrganizationId(orgIdOrUserId);
    if (!orgId) return null;
    return Profile.findOne({ organizationId: orgId });
  }

  /**
   * Check if organization has available credits
   * DYNAMIC CHECK against current PLAN
   */
  async checkCredits(orgIdOrUserId: string, type: 'chat' | 'voice' | 'automations', amount: number = 1): Promise<boolean> {
    const orgId = await this.resolveOrganizationId(orgIdOrUserId);
    if (!orgId) throw new AppError(400, 'NO_ORG', 'User not linked to an organization');

    // 1. Fetch Organization & Plan
    let org = await Organization.findById(orgId).populate('planId');
    if (!org) throw new AppError(400, 'ORG_NOT_FOUND', 'Organization not found');

    // 2. Auto-assign free plan if no plan exists
    if (!org.planId) {
      console.warn(`[Usage] Org ${orgId} has no plan. Auto-assigning free plan.`);
      const freePlan = await Plan.findOne({ slug: 'free' });
      if (freePlan) {
        org.planId = freePlan._id as mongoose.Types.ObjectId;
        org.plan = 'free';
        await org.save();
        // Re-populate after save
        org = await Organization.findById(orgId).populate('planId');
        if (!org) {
          throw new AppError(500, 'ORG_ERROR', 'Failed to reload organization after plan assignment');
        }
      } else {
        // If free plan doesn't exist, use hardcoded free limits
        console.warn(`[Usage] Free plan not found in DB. Using hardcoded free limits.`);
        const { getPlanLimits } = await import('../config/planLimits');
        const freeLimits = getPlanLimits('free') || { conversations: 20, minutes: 20, automations: 5 };
        const usage = await usageTrackerService.getOrganizationUsage(orgId);
        
        let limit = 0;
        let used = 0;
        if (type === 'chat') {
          limit = freeLimits.conversations;
          used = usage.chatMessages;
        } else if (type === 'voice') {
          limit = freeLimits.minutes;
          used = usage.callMinutes;
        } else if (type === 'automations') {
          limit = freeLimits.automations;
          used = usage.automations;
        }
        
        if (limit === -1) return true;
        return (used + amount) <= limit;
      }
    }

    if (!org || !org.planId) {
      throw new AppError(500, 'PLAN_ERROR', 'Could not assign plan to organization');
    }

    const plan: any = org.planId;

    // Use usageTrackerService for real-time accurate check
    const usage = await usageTrackerService.getOrganizationUsage(orgId);

    let limit = 0;
    let used = 0;

    if (type === 'chat') {
      limit = plan.features.chatConversations;
      used = usage.chatMessages;
    } else if (type === 'voice') {
      limit = plan.features.callMinutes;
      used = usage.callMinutes;
    } else if (type === 'automations') {
      limit = plan.features.automations;
      used = usage.automations;
    }

    // -1 means unlimited
    if (limit === -1) return true;

    return (used + amount) <= limit;
  }

  /**
   * Use credits (increment usage)
   */
  async useCredits(orgIdOrUserId: string, type: 'chat' | 'voice' | 'automations', amount: number = 1): Promise<void> {
    const orgId = await this.resolveOrganizationId(orgIdOrUserId);
    if (!orgId) return;

    let profile = await Profile.findOne({ organizationId: orgId });
    if (!profile) {
      // Create if missing logic is handled in checkCredits usually, but needed here too
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      profile = await Profile.create({
        organizationId: orgId,
        billingCycleStart: now,
        billingCycleEnd: end,
        isActive: true
      });
    }

    // Check Cycle
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(profile);
    }

    if (type === 'chat') profile.chatConversationsUsed += amount;
    else if (type === 'voice') profile.voiceMinutesUsed += amount;
    // Automations limit is now based on active count, no need to increment usage here
    // else if (type === 'automations') profile.automationsUsed += amount;

    await profile.save();
  }

  /**
   * Reset billing cycle
   */
  async resetBillingCycle(profile: IProfile): Promise<void> {
    const now = new Date();
    const billingCycleEnd = new Date(now);
    billingCycleEnd.setMonth(billingCycleEnd.getMonth() + 1);

    profile.chatConversationsUsed = 0;
    profile.voiceMinutesUsed = 0;
    profile.automationsUsed = 0;
    profile.billingCycleStart = now;
    profile.billingCycleEnd = billingCycleEnd;

    await profile.save();
  }

  /**
   * Get usage statistics for frontend (Universal method)
   */
  async getUsageStats(userId: string) {
    const user = await User.findById(userId);
    if (!user?.organizationId) return null;

    let org = await Organization.findById(user.organizationId).populate('planId');
    if (!org) return null;
    
    // Auto-assign free plan if no plan exists
    if (!org.planId) {
      console.warn(`[Usage] Org ${org._id} has no plan in getUsageStats. Auto-assigning free plan.`);
      const freePlan = await Plan.findOne({ slug: 'free' });
      if (freePlan) {
        org.planId = freePlan._id as mongoose.Types.ObjectId;
        org.plan = 'free';
        await org.save();
        // Re-populate after save
        org = await Organization.findById(user.organizationId).populate('planId');
        if (!org) {
          console.error(`[Usage] Failed to reload organization after plan assignment`);
          return null;
        }
      } else {
        // If free plan doesn't exist, return null (shouldn't happen in production)
        console.error(`[Usage] Free plan not found in DB. Cannot get usage stats.`);
        return null;
      }
    }
    
    if (!org || !org.planId) return null;
    const plan: any = org.planId;

    // Get Comprehensive Real-Time Usage from Aggregation (Single Source of Truth)
    const usage = await usageTrackerService.getOrganizationUsage(user.organizationId.toString());

    let profile = await Profile.findOne({ organizationId: user.organizationId });
    if (!profile) {
      // Create profile if missing to track billing cycle
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      profile = await Profile.create({
        organizationId: user.organizationId,
        billingCycleStart: now,
        billingCycleEnd: end,
        isActive: true
      });
    }

    // Check and Reset Billing Cycle if needed
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(profile);
      profile = await Profile.findById(profile._id);
    }

    return this.formatUsageStats(profile!, plan, usage);
  }

  /**
   * Format usage stats for frontend compatibility
   */
  private formatUsageStats(profile: IProfile, plan: any, usage: any) {
    // Helper to calc percentages and handle limits
    const calc = (used: number, limit: number) => {
      const isUnlimited = limit === -1;
      return {
        used: used || 0,
        limit: isUnlimited ? 'Unlimited' : (limit || 0),
        remaining: isUnlimited ? 'Unlimited' : Math.max(0, (limit || 0) - (used || 0)),
        percentage: isUnlimited ? 0 : Math.min(100, ((used || 0) / (limit || 1)) * 100)
      };
    };

    return {
      planName: plan.name,
      planSlug: plan.slug,
      currency: plan.currency || 'EUR',
      price: plan.price || 0,

      // Standardized Objects (For detailed progress bars/UI)
      chatConversationsStats: calc(usage.chatMessages, plan.features.chatConversations),
      voiceMinutesStats: calc(usage.callMinutes, plan.features.callMinutes),
      automationsStats: calc(usage.automations, plan.features.automations),

      // Standardized Numbers (For billing/summary views)
      metrics: {
        chatMessages: usage.chatMessages,
        callMinutes: usage.callMinutes,
        conversations: usage.chatMessages, // Alias for FE
        automations: usage.automations,
        campaignSends: usage.campaignSends || 0
      },

      // Legacy fields for backward compatibility (Numbers)
      chatConversationsUsed: usage.chatMessages,
      chatConversationsLimit: plan.features.chatConversations === -1 ? -1 : plan.features.chatConversations,
      voiceMinutesUsed: usage.callMinutes,
      voiceMinutesLimit: plan.features.callMinutes === -1 ? -1 : plan.features.callMinutes,
      automationsUsed: usage.automations,
      automationsLimit: plan.features.automations === -1 ? -1 : plan.features.automations,

      // Extra legacy keys (Numbers)
      conversations: usage.chatMessages,
      minutes: usage.callMinutes,
      chatMessages: usage.chatMessages, // Added for BillingPage
      callMinutes: usage.callMinutes, // Added for BillingPage
      automations: usage.automations,

      billingCycle: {
        start: profile.billingCycleStart,
        end: profile.billingCycleEnd,
        daysRemaining: Math.max(0, Math.ceil((new Date(profile.billingCycleEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      }
    };
  }
}

export const profileService = new ProfileService();

