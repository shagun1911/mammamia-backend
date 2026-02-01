import mongoose, { Schema, Document } from 'mongoose';

export interface IBatchCall extends Document {
  userId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  batch_call_id: string; // From Python API response (id field)
  name: string; // From Python API response
  agent_id: string;
  status: string;
  phone_number_id: string; // ElevenLabs phone_number_id
  phone_provider: string;
  created_at_unix: number;
  scheduled_time_unix: number;
  timezone?: string;
  total_calls_dispatched: number;
  total_calls_scheduled: number;
  total_calls_finished: number;
  last_updated_at_unix: number;
  retry_count: number;
  agent_name: string;
  // Store original request data for reference
  call_name: string;
  recipients_count: number;
  sender_email?: string;
  resultsProcessed?: boolean; // Track if conversations have been created from results
  conversations_synced?: boolean; // Track if conversations have been synced to Conversations
  createdAt: Date;
  updatedAt: Date;
}

const BatchCallSchema = new Schema<IBatchCall>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  batch_call_id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  agent_id: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    required: true
  },
  phone_number_id: {
    type: String,
    required: true
  },
  phone_provider: {
    type: String,
    required: true
  },
  created_at_unix: {
    type: Number,
    required: true
  },
  scheduled_time_unix: {
    type: Number,
    required: true
  },
  timezone: {
    type: String,
    required: false,
    default: 'UTC'
  },
  total_calls_dispatched: {
    type: Number,
    default: 0
  },
  total_calls_scheduled: {
    type: Number,
    required: true
  },
  total_calls_finished: {
    type: Number,
    default: 0
  },
  last_updated_at_unix: {
    type: Number,
    required: true
  },
  retry_count: {
    type: Number,
    default: 0
  },
  agent_name: {
    type: String,
    required: true
  },
  call_name: {
    type: String,
    required: true
  },
  recipients_count: {
    type: Number,
    required: true
  },
  sender_email: {
    type: String
  },
  resultsProcessed: {
    type: Boolean,
    default: false
  },
  conversations_synced: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

BatchCallSchema.index({ userId: 1, createdAt: -1 });
BatchCallSchema.index({ organizationId: 1, createdAt: -1 });
BatchCallSchema.index({ batch_call_id: 1 });

export default mongoose.model<IBatchCall>('BatchCall', BatchCallSchema);

