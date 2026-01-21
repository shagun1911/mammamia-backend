import mongoose, { Schema, Document } from 'mongoose';

export interface IPlan extends Document {
  name: string;
  slug: string;
  description: string;
  price: number; // Monthly price in USD
  currency: string;
  features: {
    callMinutes: number; // -1 for unlimited
    chatConversations: number; // -1 for unlimited
    automations: number; // -1 for unlimited
    users: number; // -1 for unlimited
    customFeatures: string[]; // Additional text features
  };
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  features: {
    callMinutes: {
      type: Number,
      required: true,
      default: 0
    },
    chatConversations: {
      type: Number,
      required: true,
      default: 0
    },
    automations: {
      type: Number,
      required: true,
      default: 0
    },
    users: {
      type: Number,
      required: true,
      default: 1
    },
    customFeatures: {
      type: [String],
      default: []
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  displayOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Ensure only one default plan
PlanSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await mongoose.model('Plan').updateMany(
      { _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

export default mongoose.model<IPlan>('Plan', PlanSchema);
