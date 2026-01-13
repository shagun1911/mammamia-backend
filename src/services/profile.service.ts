import Profile, { IProfile, ProfileType, PROFILE_LIMITS } from '../models/Profile';
import User from '../models/User';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

export class ProfileService {
  /**
   * Get profile for a user (creates default if doesn't exist)
   */
  async get(userId: string): Promise<IProfile | null> {
    const profile = await Profile.findOne({ userId });
    return profile;
  }

  /**
   * Get available profile types and their limits
   */
  getAvailableProfiles() {
    return [
      {
        type: 'mileva',
        name: 'Mileva Package',
        duration: '1 Month',
        chatConversations: PROFILE_LIMITS.mileva.chatConversations,
        voiceMinutes: PROFILE_LIMITS.mileva.voiceMinutes,
        description: 'Perfect for small teams getting started with AI'
      },
      {
        type: 'nobel',
        name: 'Nobel Package',
        duration: '1 Month',
        chatConversations: PROFILE_LIMITS.nobel.chatConversations,
        voiceMinutes: PROFILE_LIMITS.nobel.voiceMinutes,
        description: 'Ideal for growing businesses'
      },
      {
        type: 'aistein',
        name: 'AIstein Package',
        duration: '1 Month',
        chatConversations: PROFILE_LIMITS.aistein.chatConversations,
        voiceMinutes: PROFILE_LIMITS.aistein.voiceMinutes,
        description: 'For power users who need maximum capacity'
      }
    ];
  }

  /**
   * Select or change profile for a user
   */
  async selectProfile(userId: string, profileType: ProfileType): Promise<IProfile> {
    const limits = PROFILE_LIMITS[profileType];
    
    if (!limits) {
      throw new AppError(400, 'INVALID_PROFILE', 'Invalid profile type');
    }

    // Update user's selected profile
    await User.findByIdAndUpdate(userId, { selectedProfile: profileType });

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
        chatConversationsUsed: 0,
        voiceMinutesUsed: 0,
        billingCycleStart: now,
        billingCycleEnd,
        isActive: true
      });
    } else {
      // Update existing profile and reset usage if changing profile type
      profile.profileType = profileType;
      profile.chatConversationsLimit = limits.chatConversations;
      profile.voiceMinutesLimit = limits.voiceMinutes;
      profile.chatConversationsUsed = 0;
      profile.voiceMinutesUsed = 0;
      profile.billingCycleStart = now;
      profile.billingCycleEnd = billingCycleEnd;
      profile.isActive = true;
      await profile.save();
    }

    return profile;
  }

  /**
   * Check if user has available credits
   */
  async checkCredits(userId: string, type: 'chat' | 'voice', amount: number = 1): Promise<boolean> {
    const profile = await Profile.findOne({ userId, isActive: true });
    
    if (!profile) {
      // No profile selected, allow unlimited usage
      return true;
    }

    // Check if billing cycle has expired
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(userId);
      return true;
    }

    if (type === 'chat') {
      return profile.chatConversationsUsed + amount <= profile.chatConversationsLimit;
    } else {
      return profile.voiceMinutesUsed + amount <= profile.voiceMinutesLimit;
    }
  }

  /**
   * Use credits (increment usage)
   */
  async useCredits(userId: string, type: 'chat' | 'voice', amount: number = 1): Promise<void> {
    const profile = await Profile.findOne({ userId, isActive: true });
    
    if (!profile) {
      // No profile, skip tracking
      return;
    }

    // Check if billing cycle has expired
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(userId);
      return;
    }

    if (type === 'chat') {
      profile.chatConversationsUsed = Math.min(
        profile.chatConversationsUsed + amount,
        profile.chatConversationsLimit
      );
    } else {
      profile.voiceMinutesUsed = Math.min(
        profile.voiceMinutesUsed + amount,
        profile.voiceMinutesLimit
      );
    }

    await profile.save();
  }

  /**
   * Reset billing cycle (called when cycle expires)
   */
  async resetBillingCycle(userId: string): Promise<void> {
    const profile = await Profile.findOne({ userId, isActive: true });
    
    if (!profile) {
      return;
    }

    const now = new Date();
    const billingCycleEnd = new Date(now);
    billingCycleEnd.setMonth(billingCycleEnd.getMonth() + 1);

    profile.chatConversationsUsed = 0;
    profile.voiceMinutesUsed = 0;
    profile.billingCycleStart = now;
    profile.billingCycleEnd = billingCycleEnd;

    await profile.save();
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(userId: string) {
    const profile = await Profile.findOne({ userId, isActive: true });
    const user = await User.findById(userId);

    if (!profile) {
      return {
        hasProfile: false,
        selectedProfile: user?.selectedProfile || null,
        chatConversations: {
          used: 0,
          limit: 0,
          remaining: 0,
          percentage: 0
        },
        voiceMinutes: {
          used: 0,
          limit: 0,
          remaining: 0,
          percentage: 0
        },
        billingCycle: null
      };
    }

    // Check if billing cycle has expired
    if (new Date() > profile.billingCycleEnd) {
      await this.resetBillingCycle(userId);
      // Refetch after reset
      const updatedProfile = await Profile.findOne({ userId, isActive: true });
      if (!updatedProfile) {
        throw new AppError(404, 'NOT_FOUND', 'Profile not found after reset');
      }
      return this.formatUsageStats(updatedProfile, user?.selectedProfile);
    }

    return this.formatUsageStats(profile, user?.selectedProfile);
  }

  /**
   * Format usage stats for response
   */
  private formatUsageStats(profile: IProfile, selectedProfile: string | null | undefined) {
    const chatRemaining = profile.chatConversationsLimit - profile.chatConversationsUsed;
    const voiceRemaining = profile.voiceMinutesLimit - profile.voiceMinutesUsed;

    return {
      hasProfile: true,
      selectedProfile: selectedProfile || profile.profileType,
      profileType: profile.profileType,
      chatConversations: {
        used: profile.chatConversationsUsed,
        limit: profile.chatConversationsLimit,
        remaining: chatRemaining,
        percentage: (profile.chatConversationsUsed / profile.chatConversationsLimit) * 100
      },
      voiceMinutes: {
        used: profile.voiceMinutesUsed,
        limit: profile.voiceMinutesLimit,
        remaining: voiceRemaining,
        percentage: (profile.voiceMinutesUsed / profile.voiceMinutesLimit) * 100
      },
      billingCycle: {
        start: profile.billingCycleStart,
        end: profile.billingCycleEnd,
        daysRemaining: Math.ceil((profile.billingCycleEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      }
    };
  }

  /**
   * Delete profile
   */
  async delete(userId: string): Promise<void> {
    await Profile.findOneAndDelete({ userId });
    await User.findByIdAndUpdate(userId, { selectedProfile: null });
  }
}

export const profileService = new ProfileService();

