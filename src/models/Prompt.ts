import mongoose, { Schema, Document } from 'mongoose';

export interface IPrompt extends Document {
  type: 'chatbot' | 'voice';
  userInstructions: string;
  systemPrompt: string;
  version: number;
  createdAt: Date;
}

const PromptSchema = new Schema<IPrompt>({
  type: {
    type: String,
    enum: ['chatbot', 'voice'],
    required: true
  },
  userInstructions: {
    type: String,
    required: true
  },
  systemPrompt: {
    type: String,
    required: true
  },
  version: {
    type: Number,
    default: 1
  }
}, { timestamps: true });

PromptSchema.index({ type: 1, version: -1 });

export default mongoose.model<IPrompt>('Prompt', PromptSchema);

