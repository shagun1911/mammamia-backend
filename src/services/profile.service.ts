import Profile, { IProfile } from '../models/Profile';
import User from '../models/User';
import Organization from '../models/Organization';
import Plan from '../models/Plan';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

export class ProfileService {

  /**
   * Helper: Resolve Organization ID from various inputs
   */
  private async resolveOrganizationId(input: string | mongoose.Types.ObjectId): Promise<string> {
    if (mongoose.isValidObjectId(input)) {
      // Check if it's a user first
      const user = await User.findById(input).select('organizationId');
      if (user && user.organizationId) return user.organizationId.toString();

      // If not user, assume it's organizationId
      return input.toString();
    }
    return input.toString();
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
    const org = await Organization.findById(orgId).populate('planId');
    if (!org || !org.planId) {
      // Fallback: If no plan, block or allow? Safer to block or default to free.
      console.warn(`[Usage] Org ${orgId} has no plan. Blocking.`);
      return false;
    }

    const plan: any = org.planId;

    // 2. Determine Limit
    let limit = 0;
    if (type === 'chat') limit = plan.features.chatConversations;
    else if (type === 'voice') limit = plan.features.callMinutes;
    else if (type === 'automations') limit = plan.features.automations;

    // -1 means unlimited
    if (limit === -1) return true;

    // 3. Fetch Usage
    let profile = await Profile.findOne({ organizationId: orgId });

    // Auto-create if missing
    if (!profile) {
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

    // 4. Check Cycle Expiry
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(profile);
      profile = await Profile.findById(profile._id); // Refresh
      if (!profile) return false;
    }

    // 5. Compare
    let used = 0;
    if (type === 'chat') used = profile.chatConversationsUsed;
    else if (type === 'voice') used = profile.voiceMinutesUsed;
    else if (type === 'automations') used = profile.automationsUsed;

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
    else if (type === 'automations') profile.automationsUsed += amount;

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
   * Get usage statistics for frontend
   */
  async getUsageStats(userId: string) {
    const user = await User.findById(userId);
    if (!user?.organizationId) return null;

    const org = await Organization.findById(user.organizationId).populate('planId');
    if (!org || !org.planId) return null;
    const plan: any = org.planId;

    let profile = await Profile.findOne({ organizationId: user.organizationId });
    if (!profile) {
      // Return empty stats
      return this.formatUsageStats(
        {
          chatConversationsUsed: 0,
          voiceMinutesUsed: 0,
          automationsUsed: 0,
          billingCycleEnd: new Date()
        } as any,
        plan
      );
    }

    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(profile);
      profile = await Profile.findById(profile._id);
    }

    return this.formatUsageStats(profile!, plan);
  }

  private formatUsageStats(profile: IProfile, plan: any) {
    // Helper to calc percentage
    const calc = (used: number, limit: number) => {
      if (limit === -1) return { used, limit: 'Unlimited', remaining: 'Unlimited', percentage: 0 };
      return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        percentage: Math.min(100, (used / limit) * 100)
      };
    };

    return {
      planName: plan.name,
      currency: plan.currency,
      chatConversations: calc(profile.chatConversationsUsed, plan.features.chatConversations),
      voiceMinutes: calc(profile.voiceMinutesUsed, plan.features.callMinutes),
      automations: calc(profile.automationsUsed, plan.features.automations),
      billingCycle: {
        end: profile.billingCycleEnd,
        daysRemaining: Math.max(0, Math.ceil((new Date(profile.billingCycleEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      }
    };
  }
}

export const profileService = new ProfileService();

