import mongoose, { Schema, Document } from 'mongoose';

export interface IFile extends Document {
  knowledgeBaseId: mongoose.Types.ObjectId;
  filename: string;
  originalFilename: string;
  fileType: string;
  size: number;
  url: string;
  status: 'processing' | 'processed' | 'failed';
  extractedContent?: string;
  uploadedAt: Date;
}

const FileSchema = new Schema<IFile>({
  knowledgeBaseId: {
    type: Schema.Types.ObjectId,
    ref: 'KnowledgeBase',
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalFilename: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['processing', 'processed', 'failed'],
    default: 'processing'
  },
  extractedContent: String,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

FileSchema.index({ knowledgeBaseId: 1 });

export default mongoose.model<IFile>('File', FileSchema);

