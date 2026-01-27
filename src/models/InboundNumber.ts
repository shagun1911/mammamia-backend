import mongoose, { Schema, Document } from 'mongoose';

export interface IInboundNumber extends Document {
  userId: mongoose.Types.ObjectId;
  phoneNumber: string; // E.164 format (e.g., +12625925656)
  trunkId: string; // SIP trunk ID from provider
  provider: string; // Provider name (e.g., 'livekit', 'twilio')
  createdAt: Date;
  updatedAt: Date;
}

const InboundNumberSchema = new Schema<IInboundNumber>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  trunkId: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    required: true,
    default: 'livekit'
  }
}, { timestamps: true });

// Compound unique index: one record per user per phone number
InboundNumberSchema.index({ userId: 1, phoneNumber: 1 }, { unique: true });

// Index for faster queries
InboundNumberSchema.index({ userId: 1 });
InboundNumberSchema.index({ trunkId: 1 });

export default mongoose.model<IInboundNumber>('InboundNumber', InboundNumberSchema);
