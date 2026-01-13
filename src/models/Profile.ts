import mongoose, { Schema, Document } from 'mongoose';

export type ProfileType = 'mileva' | 'nobel' | 'aistein';

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
    enum: ['mileva', 'nobel', 'aistein'],
    required: true
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

// Helper to get limits for each profile type
export const PROFILE_LIMITS = {
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
  }
};

export default mongoose.model<IProfile>('Profile', ProfileSchema);

