import mongoose, { Schema, Document } from 'mongoose';

export interface IKnowledgeBase extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  collectionName: string; // RAG collection name for this knowledge base
  isDefault: boolean;
  spaceUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeBaseSchema = new Schema<IKnowledgeBase>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  collectionName: {
    type: String,
    required: true,
    index: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  spaceUsed: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

KnowledgeBaseSchema.index({ userId: 1, collectionName: 1 });

export default mongoose.model<IKnowledgeBase>('KnowledgeBase', KnowledgeBaseSchema);

