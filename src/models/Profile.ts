import mongoose, { Schema, Document } from 'mongoose';

export type ProfileType = string; // Dynamic plan slugs (free, starter, professional, enterprise, etc.)

export interface IProfile extends Document {
  userId: mongoose.Types.ObjectId;
  profileType: ProfileType;
  // Usage limits per month
  chatConversationsLimit: number;
  voiceMinutesLimit: number;
  // Current usage (resets monthly)
  chatConversationsUsed: number;
  voiceMinutesUsed: number;
  // Billing cycle
  billingCycleStart: Date;
  billingCycleEnd: Date;
  // Status
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema = new Schema<IProfile>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  profileType: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  chatConversationsLimit: {
    type: Number,
    required: true
  },
  voiceMinutesLimit: {
    type: Number,
    required: true
  },
  chatConversationsUsed: {
    type: Number,
    default: 0
  },
  voiceMinutesUsed: {
    type: Number,
    default: 0
  },
  billingCycleStart: {
    type: Date,
    required: true
  },
  billingCycleEnd: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

ProfileSchema.index({ userId: 1 });

// Legacy profile limits (deprecated - use Plan model instead)
// Kept for backwards compatibility
export const PROFILE_LIMITS: Record<string, { chatConversations: number; voiceMinutes: number }> = {
  mileva: {
    chatConversations: 500,
    voiceMinutes: 250
  },
  nobel: {
    chatConversations: 1000,
    voiceMinutes: 1000
  },
  aistein: {
    chatConversations: 2000,
    voiceMinutes: 2000
  },
  // New plan defaults (if Plan model lookup fails)
  free: {
    chatConversations: 100,
    voiceMinutes: 100
  },
  starter: {
    chatConversations: 1000,
    voiceMinutes: 500
  },
  professional: {
    chatConversations: 5000,
    voiceMinutes: 2000
  },
  enterprise: {
    chatConversations: -1, // unlimited
    voiceMinutes: -1 // unlimited
  }
};

export default mongoose.model<IProfile>('Profile', ProfileSchema);

