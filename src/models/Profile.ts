import mongoose, { Schema, Document } from 'mongoose';

export type ProfileType = string; // Dynamic plan slugs (mileva-pack, nobel-pack, aistein-pro-pack, set-up, etc.)

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
  'mileva-pack': {
    chatConversations: 1000,
    voiceMinutes: 500
  },
  'nobel-pack': {
    chatConversations: 2500,
    voiceMinutes: 1000
  },
  'aistein-pro-pack': {
    chatConversations: 5000,
    voiceMinutes: 2000
  },
  'set-up': {
    chatConversations: 0,
    voiceMinutes: 0
  }
};

export default mongoose.model<IProfile>('Profile', ProfileSchema);

