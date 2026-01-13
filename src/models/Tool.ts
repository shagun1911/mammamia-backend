import mongoose, { Document, Schema } from 'mongoose';

export interface IToolProperty {
  name: string;
  type: string;
  description: string;
  required: boolean;
  value: string;
}

export interface ITool extends Document {
  userId: mongoose.Types.ObjectId;
  tool_id: string;
  tool_name: string;
  tool_type: string;
  description: string;
  properties: IToolProperty[];
  createdAt: Date;
  updatedAt: Date;
}

const ToolPropertySchema = new Schema<IToolProperty>({
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['string', 'number', 'boolean', 'email', 'url', 'textarea'],
  },
  description: {
    type: String,
    required: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  value: {
    type: String,
    default: '',
  },
}, { _id: false });

const ToolSchema = new Schema<ITool>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tool_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tool_name: {
      type: String,
      required: true,
      trim: true,
    },
    tool_type: {
      type: String,
      required: true,
      enum: ['email', 'sms', 'api_call', 'webhook', 'database', 'notification', 'other'],
    },
    description: {
      type: String,
      required: true,
    },
    properties: {
      type: [ToolPropertySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for userId and tool_name (unique per user)
ToolSchema.index({ userId: 1, tool_name: 1 }, { unique: true });

const Tool = mongoose.model<ITool>('Tool', ToolSchema);

export default Tool;

