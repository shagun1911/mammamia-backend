import mongoose, { Schema, Document } from 'mongoose';
import Plan from './Plan';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  domain?: string;
  plan: string; // Plan slug (dynamic)
  planId?: mongoose.Types.ObjectId; // Reference to Plan model
  status: 'active' | 'suspended' | 'trial';
  settings: {
    timezone?: string;
    language?: string;
    [key: string]: any;
  };
  ownerId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>({
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
  domain: {
    type: String,
    lowercase: true,
    trim: true
  },
  plan: {
    type: String,
    default: 'free',
    index: true
  },
  planId: {
    type: Schema.Types.ObjectId,
    ref: 'Plan',
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'trial'],
    default: 'active'
  },
  settings: {
    type: Schema.Types.Mixed,
    default: {}
  },
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for faster lookups
OrganizationSchema.index({ ownerId: 1 });

// Pre-save hook to auto-assign free plan if not set
OrganizationSchema.pre('save', async function(next) {
  if (this.isNew && !this.planId) {
    try {
      // Find the free plan
      const freePlan = await Plan.findOne({ slug: 'free' }).lean();
      if (freePlan) {
        this.planId = freePlan._id as mongoose.Types.ObjectId;
        this.plan = 'free';
        console.log(`✅ Auto-assigned free plan to organization: ${this.name}`);
      }
    } catch (error) {
      console.warn('⚠️  Could not auto-assign free plan:', error);
    }
  }
  next();
});

export default mongoose.model<IOrganization>('Organization', OrganizationSchema);
