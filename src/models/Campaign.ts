import mongoose, { Schema, Document } from 'mongoose';

export interface IFollowUp {
  templateId: string;
  condition: 'if_no_response' | 'always';
  delay: number;
  delayUnit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
  order: number;
}

export interface ISMSBody {
  message: string;
}

export interface IEmailBody {
  subject: string;
  body: string;
  is_html: boolean;
}

export interface ICampaign extends Document {
  name: string;
  listId: mongoose.Types.ObjectId;
  communicationTypes: ('call' | 'sms' | 'email')[];
  smsBody?: ISMSBody;
  emailBody?: IEmailBody;
  templateId?: string;
  templateVariables?: Record<string, string>;
  dynamicInstruction?: string;
  language?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  scheduledAt?: Date;
  sentAt?: Date;
  cancelledAt?: Date;
  followUps: IFollowUp[];
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>({
  name: {
    type: String,
    required: true
  },
  listId: {
    type: Schema.Types.ObjectId,
    ref: 'ContactList',
    required: true
  },
  communicationTypes: [{
    type: String,
    enum: ['call', 'sms', 'email'],
    required: true
  }],
  smsBody: {
    message: String
  },
  emailBody: {
    subject: String,
    body: String,
    is_html: { type: Boolean, default: false }
  },
  templateId: String,
  templateVariables: {
    type: Map,
    of: String
  },
  dynamicInstruction: String,
  language: {
    type: String,
    default: 'en'
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'draft'
  },
  scheduledAt: Date,
  sentAt: Date,
  cancelledAt: Date,
  followUps: [{
    templateId: { type: String, required: true },
    condition: {
      type: String,
      enum: ['if_no_response', 'always'],
      required: true
    },
    delay: { type: Number, required: true },
    delayUnit: {
      type: String,
      enum: ['minutes', 'hours', 'days', 'weeks', 'months'],
      required: true
    },
    order: { type: Number, required: true }
  }]
}, { timestamps: true });

CampaignSchema.index({ status: 1 });
CampaignSchema.index({ scheduledAt: 1 });

export default mongoose.model<ICampaign>('Campaign', CampaignSchema);

