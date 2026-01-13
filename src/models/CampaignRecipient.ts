import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaignRecipient extends Document {
  campaignId: mongoose.Types.ObjectId;
  contactId: mongoose.Types.ObjectId;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  repliedAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  messageId?: string;
}

const CampaignRecipientSchema = new Schema<ICampaignRecipient>({
  campaignId: {
    type: Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  contactId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  openedAt: Date,
  clickedAt: Date,
  repliedAt: Date,
  failedAt: Date,
  failureReason: String,
  messageId: String
});

CampaignRecipientSchema.index({ campaignId: 1 });
CampaignRecipientSchema.index({ contactId: 1 });
CampaignRecipientSchema.index({ status: 1 });

export default mongoose.model<ICampaignRecipient>('CampaignRecipient', CampaignRecipientSchema);

