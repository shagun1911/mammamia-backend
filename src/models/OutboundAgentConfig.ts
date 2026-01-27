import mongoose, { Schema, Document } from 'mongoose';

export interface IOutboundAgentConfig extends Document {
  userId: mongoose.Types.ObjectId;
  outboundNumber: string; // Phone number in E.164 format (e.g., +12625925656)
  selectedVoice: string;
  customVoiceId?: string;
  humanOperatorPhone: string;
  escalationRules: string[];
  greetingMessage?: string;
  language?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OutboundAgentConfigSchema = new Schema<IOutboundAgentConfig>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  outboundNumber: {
    type: String,
    required: true
  },
  selectedVoice: {
    type: String,
    default: 'adam'
  },
  customVoiceId: {
    type: String,
    default: ''
  },
  humanOperatorPhone: {
    type: String,
    default: ''
  },
  escalationRules: {
    type: [String],
    default: []
  },
  greetingMessage: {
    type: String,
    default: 'Hello! How can I help you today?'
  },
  language: {
    type: String,
    default: 'en'
  }
}, { timestamps: true });

// Compound index: one config per user per outbound number
OutboundAgentConfigSchema.index({ userId: 1, outboundNumber: 1 }, { unique: true });
OutboundAgentConfigSchema.index({ userId: 1 });

export default mongoose.model<IOutboundAgentConfig>('OutboundAgentConfig', OutboundAgentConfigSchema);
