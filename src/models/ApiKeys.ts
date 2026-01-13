import mongoose, { Schema, Document } from 'mongoose';

export interface IApiKeys extends Document {
  userId: mongoose.Types.ObjectId;
  llmProvider: 'openai' | 'gemini';
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeysSchema = new Schema<IApiKeys>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  llmProvider: {
    type: String,
    enum: ['openai', 'gemini'],
    default: 'openai',
    required: true
  },
  apiKey: {
    type: String,
    required: true
  }
}, { timestamps: true });

ApiKeysSchema.index({ userId: 1 });

export default mongoose.model<IApiKeys>('ApiKeys', ApiKeysSchema);

