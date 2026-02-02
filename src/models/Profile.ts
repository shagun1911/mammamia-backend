import mongoose, { Schema, Document } from 'mongoose';

// Usage Tracker linked to Organization
// (Previously known as Profile)
export interface IProfile extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId; // Deprecated, kept for migration

  // Current usage counters (resets monthly)
  chatConversationsUsed: number;
  voiceMinutesUsed: number;
  automationsUsed: number;

  // Billing cycle
  billingCycleStart: Date;
  billingCycleEnd: Date;

  // Meta
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema = new Schema<IProfile>({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: false, // Made false temporarily for migration, should be true
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Deprecated
    index: true
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

// Ensure strict uniqueness if needed, but one usage doc per org is the goal
ProfileSchema.index({ organizationId: 1 }, { unique: true, partialFilterExpression: { organizationId: { $exists: true } } });

// CONSTANTS for backward compat (but logic should move to PLAN)
export const PROFILE_LIMITS: Record<string, any> = {
  // Deprecated - strictly use Plan model features
};

export default mongoose.model<IProfile>('Profile', ProfileSchema);

