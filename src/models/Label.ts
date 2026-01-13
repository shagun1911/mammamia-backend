import mongoose, { Schema, Document } from 'mongoose';

export interface ILabel extends Document {
  name: string;
  color: string;
  createdAt: Date;
}

const LabelSchema = new Schema<ILabel>({
  name: { type: String, required: true, unique: true },
  color: { type: String, default: '#6366f1' }
}, { timestamps: true });

export default mongoose.model<ILabel>('Label', LabelSchema);

