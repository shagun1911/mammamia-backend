import mongoose, { Schema, Document } from 'mongoose';

export interface IInboundAgentConfig extends Document {
  userId: mongoose.Types.ObjectId;
  voice_id: string; // Selected voice from settings (either selectedVoice or customVoiceId)
  collections: string[]; // Default knowledge base collection names
  language: string; // Language from AI behavior settings or phone settings
  calledNumber: string; // First inbound phone number from phone settings
  agent_instruction: string; // System prompt from AI behavior
  greeting_message: string; // Greeting message for inbound calls
  ecommerce_credentials?: {
    platform?: string;
    base_url?: string;
    api_key?: string;
    api_secret?: string;
    access_token?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const InboundAgentConfigSchema = new Schema<IInboundAgentConfig>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  voice_id: {
    type: String,
    default: ''
  },
  collections: {
    type: [String],
    default: []
  },
  language: {
    type: String,
    default: 'en'
  },
  calledNumber: {
    type: String,
    default: ''
  },
  agent_instruction: {
    type: String,
    default: ''
  },
  greeting_message: {
    type: String,
    default: 'Hello! How can I help you today?'
  },
  ecommerce_credentials: {
    platform: String,
    base_url: String,
    api_key: String,
    api_secret: String,
    access_token: String
  }
}, { timestamps: true });

// Create compound unique index on userId and calledNumber
InboundAgentConfigSchema.index({ userId: 1, calledNumber: 1 }, { unique: true });

export default mongoose.model<IInboundAgentConfig>('InboundAgentConfig', InboundAgentConfigSchema, 'inbound-agent-config');

