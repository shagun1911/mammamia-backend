import mongoose, { Schema, Document } from 'mongoose';

export interface IFAQ extends Document {
  knowledgeBaseId: mongoose.Types.ObjectId;
  question: string;
  answer: string;
  createdAt: Date;
  updatedAt: Date;
}

const FAQSchema = new Schema<IFAQ>({
  knowledgeBaseId: {
    type: Schema.Types.ObjectId,
    ref: 'KnowledgeBase',
    required: true
  },
  question: {
    type: String,
    required: true,
    maxlength: 300
  },
  answer: {
    type: String,
    required: true,
    maxlength: 1200
  }
}, { timestamps: true });

FAQSchema.index({ knowledgeBaseId: 1 });
FAQSchema.index({ question: 'text', answer: 'text' });

export default mongoose.model<IFAQ>('FAQ', FAQSchema);

