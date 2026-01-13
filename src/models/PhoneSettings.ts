import mongoose, { Schema, Document } from 'mongoose';

export interface IPhoneSettings extends Document {
  userId: mongoose.Types.ObjectId;
  selectedVoice: string;
  customVoiceId?: string;
  twilioPhoneNumber: string;
  livekitSipTrunkId: string;
  twilioTrunkSid: string;
  terminationUri: string;
  originationUri: string;
  humanOperatorPhone: string;
  greetingMessage?: string;
  language?: string;
  
  // Generic SIP Trunk fields
  sipAddress?: string;
  sipUsername?: string;
  providerName?: string;
  transport?: string;
  
  // Inbound Trunk fields
  inboundTrunkId?: string;
  inboundTrunkName?: string;
  inboundPhoneNumbers?: string[];
  inboundDispatchRuleId?: string;
  inboundDispatchRuleName?: string;
  
  isConfigured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PhoneSettingsSchema = new Schema<IPhoneSettings>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  selectedVoice: {
    type: String,
    default: 'adam'
  },
  customVoiceId: {
    type: String,
    default: ''
  },
  twilioPhoneNumber: {
    type: String,
    default: ''
  },
  livekitSipTrunkId: {
    type: String,
    default: ''
  },
  twilioTrunkSid: {
    type: String,
    default: ''
  },
  terminationUri: {
    type: String,
    default: ''
  },
  originationUri: {
    type: String,
    default: ''
  },
  humanOperatorPhone: {
    type: String,
    default: ''
  },
  greetingMessage: {
    type: String,
    default: 'Hello! How can I help you today?'
  },
  language: {
    type: String,
    default: 'en'
  },
  
  // Generic SIP Trunk fields
  sipAddress: {
    type: String,
    default: ''
  },
  sipUsername: {
    type: String,
    default: ''
  },
  providerName: {
    type: String,
    default: ''
  },
  transport: {
    type: String,
    default: ''
  },
  
  // Inbound Trunk fields
  inboundTrunkId: {
    type: String,
    default: ''
  },
  inboundTrunkName: {
    type: String,
    default: ''
  },
  inboundPhoneNumbers: {
    type: [String],
    default: []
  },
  inboundDispatchRuleId: {
    type: String,
    default: ''
  },
  inboundDispatchRuleName: {
    type: String,
    default: ''
  },
  
  isConfigured: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

export default mongoose.model<IPhoneSettings>('PhoneSettings', PhoneSettingsSchema);

