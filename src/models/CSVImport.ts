import mongoose, { Schema, Document } from 'mongoose';

export interface ICSVImport extends Document {
  userId: string;
  organizationId: string;
  listId: string;
  filename: string;
  fileSize: number;
  totalRows: number;
  processedRows: number;
  importedCount: number;
  failedCount: number;
  duplicateCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  importErrors: Array<{ row: number; error: string }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CSVImportSchema = new Schema<ICSVImport>(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    organizationId: {
      type: String,
      required: true,
      index: true
    },
    listId: {
      type: String,
      required: true,
      index: true
    },
    filename: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    totalRows: {
      type: Number,
      default: 0
    },
    processedRows: {
      type: Number,
      default: 0
    },
    importedCount: {
      type: Number,
      default: 0
    },
    failedCount: {
      type: Number,
      default: 0
    },
    duplicateCount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    importErrors: [{
      row: Number,
      error: String
    }],
    startedAt: Date,
    completedAt: Date
  },
  {
    timestamps: true
  }
);

export default mongoose.model<ICSVImport>('CSVImport', CSVImportSchema);
