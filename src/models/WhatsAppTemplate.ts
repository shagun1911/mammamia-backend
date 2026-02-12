import mongoose, { Schema, Document } from 'mongoose';

export interface IWhatsAppTemplate extends Document {
  name: string;
  language: string;
  status: string;
  category: string;
  components: any[];
  variables: string[];
  // Parameter counts extracted from template metadata
  bodyParamCount?: number;
  headerParamCount?: number;
  buttonParamCount?: number;
  totalParamCount?: number;
  createdAt: Date;
}

const WhatsAppTemplateSchema = new Schema<IWhatsAppTemplate>({
  name: {
    type: String,
    required: true
  },
  language: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  category: String,
  components: [Schema.Types.Mixed],
  variables: [String],
  // Parameter counts
  bodyParamCount: { type: Number, default: 0 },
  headerParamCount: { type: Number, default: 0 },
  buttonParamCount: { type: Number, default: 0 },
  totalParamCount: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);

