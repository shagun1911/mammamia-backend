import mongoose, { Schema, Document } from 'mongoose';

export interface IPhoneNumber extends Document {
  phone_number_id: string;
  label: string;
  phone_number: string;
  sid: string;
  token: string;
  provider?: string;
  organizationId?: mongoose.Types.ObjectId;
  created_at_unix?: number;
  supports_inbound?: boolean;
  supports_outbound?: boolean;
  inbound_trunk_config?: {
    address: string;
    credentials: {
      username: string;
      password: string;
    };
  };
  outbound_trunk_config?: {
    address: string;
    credentials: {
      username: string;
      password: string;
    };
    media_encryption?: string;
    transport?: string;
  };
  elevenlabs_phone_number_id?: string; // ElevenLabs-generated phone_number_id - REQUIRED for outbound calls
  createdAt?: Date;
  updatedAt?: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>({
  phone_number_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  label: {
    type: String,
    required: true
  },
  phone_number: {
    type: String,
    required: true
  },
  sid: {
    type: String,
    required: false,
    default: ''
  },
  token: {
    type: String,
    required: false,
    default: ''
  },
  provider: {
    type: String,
    default: 'twilio'
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization'
  },
  created_at_unix: {
    type: Number,
    default: () => Math.floor(Date.now() / 1000)
  },
  supports_inbound: {
    type: Boolean,
    default: false
  },
  supports_outbound: {
    type: Boolean,
    default: false
  },
  inbound_trunk_config: {
    type: {
      address: String,
      credentials: {
        username: String,
        password: String
      }
    },
    required: false
  },
  outbound_trunk_config: {
    type: {
      address: String,
      credentials: {
        username: String,
        password: String
      },
      media_encryption: String,
      transport: String
    },
    required: false
  },
  elevenlabs_phone_number_id: {
    type: String,
    required: false,
    index: true
  }
}, { timestamps: true });

export default mongoose.model<IPhoneNumber>('PhoneNumber', PhoneNumberSchema);
