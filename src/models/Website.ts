import mongoose, { Schema, Document } from 'mongoose';

export interface IWebsitePage {
  url: string;
  title: string;
  content: string;
  status: 'active' | 'failed' | 'pending';
  lastScraped?: Date;
}

export interface IWebsite extends Document {
  knowledgeBaseId: mongoose.Types.ObjectId;
  domain: string;
  pages: IWebsitePage[];
  pagesCount: number;
  lastUpdated?: Date;
  createdAt: Date;
}

const WebsiteSchema = new Schema<IWebsite>({
  knowledgeBaseId: {
    type: Schema.Types.ObjectId,
    ref: 'KnowledgeBase',
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  pages: [{
    url: { type: String, required: true },
    title: String,
    content: String,
    status: {
      type: String,
      enum: ['active', 'failed', 'pending'],
      default: 'pending'
    },
    lastScraped: Date
  }],
  pagesCount: {
    type: Number,
    default: 0
  },
  lastUpdated: Date
}, { timestamps: true });

WebsiteSchema.index({ knowledgeBaseId: 1 });
WebsiteSchema.index({ domain: 1 });

export default mongoose.model<IWebsite>('Website', WebsiteSchema);

