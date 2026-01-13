import mongoose, { Schema, Document } from 'mongoose';

export interface IWhatsAppTemplate extends Document {
  name: string;
  language: string;
  status: string;
  category: string;
  components: any[];
  variables: string[];
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
  variables: [String]
}, { timestamps: true });

export default mongoose.model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);

