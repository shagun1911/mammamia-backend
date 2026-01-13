import mongoose, { Schema, Document } from 'mongoose';

export interface IFAQ {
  id: string;
  question: string;
  answer: string;
  createdAt: Date;
}

export interface IWebsitePage {
  id: string;
  url: string;
  selected: boolean;
}

export interface IWebsite {
  id: string;
  domain: string;
  url: string;
  pages: IWebsitePage[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  addedAt: Date;
}

export interface IFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: Date;
  path?: string;
}

export interface IKnowledgeBase extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  collectionName: string; // RAG collection name for this knowledge base
  isDefault: boolean;
  spaceUsed: number;
  faqs: IFAQ[];
  websites: IWebsite[];
  files: IFile[];
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeBaseSchema = new Schema<IKnowledgeBase>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  collectionName: {
    type: String,
    required: true,
    unique: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  spaceUsed: {
    type: Number,
    default: 0
  },
  faqs: [{
    id: String,
    question: String,
    answer: String,
    createdAt: { type: Date, default: Date.now }
  }],
  websites: [{
    id: String,
    domain: String,
    url: String,
    pages: [{
      id: String,
      url: String,
      selected: Boolean
    }],
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    addedAt: { type: Date, default: Date.now }
  }],
  files: [{
    id: String,
    name: String,
    type: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now },
    path: String
  }]
}, { timestamps: true });

export default mongoose.model<IKnowledgeBase>('KnowledgeBase', KnowledgeBaseSchema);

