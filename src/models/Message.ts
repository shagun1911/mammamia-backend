import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  sender: 'customer' | 'ai' | 'operator';
  operatorId?: mongoose.Types.ObjectId;
  text: string;
  type: 'message' | 'internal_note';
  attachments: Array<{
    type: string;
    url: string;
    filename: string;
    size: number;
  }>;
  sourcesUsed: string[];
  topics: string[];
  timestamp: Date;
  metadata?: Record<string, any>;
}

const MessageSchema = new Schema<IMessage>({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: String,
    enum: ['customer', 'ai', 'operator'],
    required: true
  },
  operatorId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  text: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['message', 'internal_note'],
    default: 'message'
  },
  attachments: [{
    type: String,
    url: String,
    filename: String,
    size: Number
  }],
  sourcesUsed: [String],
  topics: [String],
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
});

MessageSchema.index({ conversationId: 1, timestamp: -1 });
MessageSchema.index({ text: 'text' });

export default mongoose.model<IMessage>('Message', MessageSchema);
