import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailTemplateParameter {
  name: string;
  description: string;
  required: boolean;
}

export interface IEmailTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  template_id: string; // From external Python API response
  name: string;
  description: string;
  subject_template: string;
  body_template: string;
  parameters: IEmailTemplateParameter[];
  tool_id: string; // From external Python API response
  webhook_base_url?: string;
  created_at?: string; // From external Python API response
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateParameterSchema = new Schema<IEmailTemplateParameter>({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  required: {
    type: Boolean,
    required: true,
    default: false,
  },
}, { _id: false });

const EmailTemplateSchema = new Schema<IEmailTemplate>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  template_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  subject_template: {
    type: String,
    required: true,
  },
  body_template: {
    type: String,
    required: true,
  },
  parameters: {
    type: [EmailTemplateParameterSchema],
    default: [],
  },
  tool_id: {
    type: String,
    required: true,
  },
  webhook_base_url: {
    type: String,
  },
  created_at: {
    type: String,
  },
}, { timestamps: true });

EmailTemplateSchema.index({ userId: 1, createdAt: -1 });
EmailTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model<IEmailTemplate>('EmailTemplate', EmailTemplateSchema);

