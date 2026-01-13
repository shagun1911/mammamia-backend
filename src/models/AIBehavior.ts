import mongoose, { Schema, Document } from 'mongoose';

export interface IAIBehavior extends Document {
  userId: mongoose.Types.ObjectId;
  knowledgeBaseId?: mongoose.Types.ObjectId;
  chatAgent: {
    improvements: string;
    systemPrompt: string;
    humanOperator: {
      escalationRules: string[];
      availability: {
        alwaysAvailable: boolean;
        schedule: Map<string, { enabled: boolean; from: string; to: string }>;
      };
    };
  };
  voiceAgent: {
    improvements: string;
    systemPrompt: string;
    language: string; // Language code for voice agent (en, ar, tr, es, it)
    humanOperator: {
      phoneNumber: string;
      escalationRules: string[];
      availability: {
        alwaysAvailable: boolean;
        schedule: Map<string, { enabled: boolean; from: string; to: string }>;
      };
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

const AIBehaviorSchema = new Schema<IAIBehavior>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  knowledgeBaseId: {
    type: Schema.Types.ObjectId,
    ref: 'KnowledgeBase'
  },
  chatAgent: {
    improvements: { type: String, default: '' },
    systemPrompt: { type: String, default: '' },
    humanOperator: {
      escalationRules: { type: [String], default: [] },
      availability: {
        alwaysAvailable: { type: Boolean, default: false },
        schedule: {
          type: Map,
          of: new Schema({
            enabled: { type: Boolean, default: true },
            from: { type: String, default: '09:00' },
            to: { type: String, default: '17:00' }
          }, { _id: false }),
          default: () => new Map()
        }
      }
    }
  },
  voiceAgent: {
    improvements: { type: String, default: '' },
    systemPrompt: { type: String, default: '' },
    language: { type: String, default: 'en' }, // Default to English
    humanOperator: {
      phoneNumber: { type: String, default: '' },
      escalationRules: { type: [String], default: [] },
      availability: {
        alwaysAvailable: { type: Boolean, default: false },
        schedule: {
          type: Map,
          of: new Schema({
            enabled: { type: Boolean, default: true },
            from: { type: String, default: '09:00' },
            to: { type: String, default: '17:00' }
          }, { _id: false }),
          default: () => new Map()
        }
      }
    }
  }
}, { timestamps: true });

export default mongoose.model<IAIBehavior>('AIBehavior', AIBehaviorSchema);
