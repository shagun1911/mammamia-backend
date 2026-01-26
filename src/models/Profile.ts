import mongoose, { Schema, Document } from 'mongoose';

export type ProfileType = string; // Dynamic plan slugs (mileva-pack, nobel-pack, aistein-pro-pack, set-up, etc.)

export interface IProfile extends Document {
  userId: mongoose.Types.ObjectId;
  profileType: ProfileType;
  // Usage limits per month
  chatConversationsLimit: number;
  voiceMinutesLimit: number;
  automationsLimit: number;
  // Current usage (resets monthly)
  chatConversationsUsed: number;
  voiceMinutesUsed: number;
  automationsUsed: number;
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
  automationsLimit: {
    type: Number,
    required: true,
    default: 5
  },
  chatConversationsUsed: {
    type: Number,
    default: 0
  },
  voiceMinutesUsed: {
    type: Number,
    default: 0
  },
  automationsUsed: {
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

// Using field-level indexing


// Legacy profile limits (deprecated - use Plan model instead)
// Kept for backwards compatibility
export const PROFILE_LIMITS: Record<string, { chatConversations: number; voiceMinutes: number; automations?: number }> = {
  'free': {
    chatConversations: 100,
    voiceMinutes: 100,
    automations: 5
  },
  'mileva-pack': {
    chatConversations: 1000,
    voiceMinutes: 500,
    automations: 25
  },
  'nobel-pack': {
    chatConversations: 2500,
    voiceMinutes: 1000,
    automations: 50
  },
  'aistein-pro-pack': {
    chatConversations: 5000,
    voiceMinutes: 2000,
    automations: 100
  },
  'set-up': {
    chatConversations: 0,
    voiceMinutes: 0,
    automations: 0
  }
};

export default mongoose.model<IProfile>('Profile', ProfileSchema);

