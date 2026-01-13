import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomProperty extends Document {
  name: string;
  dataType: 'string' | 'number';
  createdAt: Date;
}

const CustomPropertySchema = new Schema<ICustomProperty>({
  name: {
    type: String,
    required: true,
    unique: true
  },
  dataType: {
    type: String,
    enum: ['string', 'number'],
    required: true
  }
}, { timestamps: true });

export default mongoose.model<ICustomProperty>('CustomProperty', CustomPropertySchema);

