import mongoose, { Schema, Document } from 'mongoose';

export interface IAutomationNode {
  id: string;
  type: 'trigger' | 'delay' | 'action' | 'condition';
  service: string;
  config: Record<string, any>;
  position: number;
}

export interface IAutomation extends Document {
  userId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  nodes: IAutomationNode[];
  isActive: boolean;
  executionCount: number;
  lastExecutedAt?: Date;
  webhookUrl?: string; // Custom webhook URL for external integrations (n8n, etc.)
  createdAt: Date;
  updatedAt: Date;
}

const AutomationSchema = new Schema<IAutomation>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  nodes: [{
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['trigger', 'delay', 'action', 'condition'],
      required: true
    },
    service: { type: String, required: true },
    config: { type: Map, of: Schema.Types.Mixed },
    position: { type: Number, required: true }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  executionCount: {
    type: Number,
    default: 0
  },
  lastExecutedAt: Date,
  webhookUrl: {
    type: String,
    default: null
  }
}, { timestamps: true });

AutomationSchema.index({ isActive: 1 });
AutomationSchema.index({ 'nodes.service': 1 });

export default mongoose.model<IAutomation>('Automation', AutomationSchema);

