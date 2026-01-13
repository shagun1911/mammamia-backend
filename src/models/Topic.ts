import mongoose, { Schema, Document } from 'mongoose';

export interface ITopic extends Document {
  name: string;
  color: string;
  createdAt: Date;
}

const TopicSchema = new Schema<ITopic>({
  name: {
    type: String,
    required: true,
    unique: true
  },
  color: {
    type: String,
    default: '#6366f1'
  }
}, { timestamps: true });

export default mongoose.model<ITopic>('Topic', TopicSchema);

