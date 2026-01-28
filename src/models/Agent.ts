import mongoose, { Schema, Document } from 'mongoose';

export interface IAgent extends Document {
  userId: mongoose.Types.ObjectId;
  agent_id: string; // From external Python API response
  name: string;
  first_message: string;
  system_prompt: string;
  language: string;
  voice_id?: string;
  knowledge_base_ids: string[]; // Array of document IDs
  tool_ids: string[]; // Array of tool IDs
  createdAt: Date;
  updatedAt: Date;
}

const AgentSchema = new Schema<IAgent>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  agent_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  first_message: {
    type: String,
    required: true
  },
  system_prompt: {
    type: String,
    required: true
  },
  language: {
    type: String,
    required: true,
    default: 'en'
  },
  voice_id: {
    type: String
  },
  knowledge_base_ids: {
    type: [String],
    default: []
  },
  tool_ids: {
    type: [String],
    default: []
  }
}, { timestamps: true });

AgentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IAgent>('Agent', AgentSchema);

