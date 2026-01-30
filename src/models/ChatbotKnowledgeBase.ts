import mongoose, { Schema, Document } from 'mongoose';

export interface IChatbotKnowledgeBase extends Document {
  kb_id: string;                    // Unique ID for this KB (e.g., "kb_xxx")
  linked_kb_id: string | null;      // Links to KnowledgeBaseDocument.document_id (if exists)
  
  userId: mongoose.Types.ObjectId;
  name: string;                     // Human readable name
  collection_name: string;          // RAG collection name (e.g., "user_xxx_kb")
  source_type: 'text' | 'url' | 'file';
  
  source_payload: {
    text?: string;                // if source_type = text
    url?: string;                 // if source_type = url
    file_name?: string;           // if source_type = file
    file_type?: string;           // pdf, docx, txt
    file_size_bytes?: number;
  };
  
  status: 'processing' | 'ready' | 'failed';
  
  metadata: Record<string, any>;  // extensible (language, tags, department)
  
  created_at_unix: number;
  updated_at_unix: number;
}

const ChatbotKnowledgeBaseSchema = new Schema<IChatbotKnowledgeBase>({
  kb_id: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  linked_kb_id: { 
    type: String, 
    default: null,
    index: true
  },
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  name: { 
    type: String, 
    required: true 
  },
  collection_name: {
    type: String,
    required: true,
    index: true
  },
  source_type: { 
    type: String, 
    enum: ['text', 'url', 'file'], 
    required: true 
  },
  source_payload: {
    text: String,
    url: String,
    file_name: String,
    file_type: String,
    file_size_bytes: Number,
  },
  status: { 
    type: String, 
    enum: ['processing', 'ready', 'failed'], 
    default: 'ready' 
  },
  metadata: { 
    type: Schema.Types.Mixed, 
    default: {} 
  },
  created_at_unix: { 
    type: Number, 
    required: true 
  },
  updated_at_unix: { 
    type: Number, 
    required: true 
  },
}, { timestamps: false }); // We use unix timestamps manually

// Create indexes
ChatbotKnowledgeBaseSchema.index({ userId: 1, collection_name: 1 });
ChatbotKnowledgeBaseSchema.index({ linked_kb_id: 1 });
ChatbotKnowledgeBaseSchema.index({ status: 1 });

export default mongoose.model<IChatbotKnowledgeBase>('ChatbotKnowledgeBase', ChatbotKnowledgeBaseSchema);

