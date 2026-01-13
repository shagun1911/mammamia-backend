import mongoose, { Schema, Document } from 'mongoose';

export interface IFolder extends Document {
  name: string;
  color: string;
  createdAt: Date;
}

const FolderSchema = new Schema<IFolder>({
  name: { type: String, required: true },
  color: { type: String, default: '#6366f1' }
}, { timestamps: true });

export default mongoose.model<IFolder>('Folder', FolderSchema);

