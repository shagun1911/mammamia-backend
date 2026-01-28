import mongoose, { Schema, Document } from 'mongoose';

export interface IKnowledgeBaseDocument extends Document {
  id: string;                    // KBDoc_xxx
  document_id: string;            // SAME as id

  userId: mongoose.Types.ObjectId;
  name: string;                   // Human readable name
  source_type: 'text' | 'url' | 'file';

  folder_id: string | null;       // Parent folder reference
  folder_path: string | null;     // Resolved path ("/HR/Policies")

  status: 'processing' | 'ready' | 'failed';

  source_payload: {
    text?: string;                // if source_type = text
    url?: string;                 // if source_type = url
    file_name?: string;           // if source_type = file
    file_type?: string;           // pdf, docx, txt
    file_size_bytes?: number;
  };

  ingestion: {
    chunk_count: number;
    embedding_model: string;
    vector_store: 'pinecone' | 'weaviate' | 'pgvector' | 'chroma'; // Added chroma as it's used in current code
  };

  metadata: Record<string, any>;  // extensible (language, tags, department)

  created_at_unix: number;
  updated_at_unix: number;
}

const KnowledgeBaseDocumentSchema = new Schema<IKnowledgeBaseDocument>({
  id: { type: String, required: true, unique: true },
  document_id: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  source_type: { 
    type: String, 
    enum: ['text', 'url', 'file'], 
    required: true 
  },
  folder_id: { type: String, default: null },
  folder_path: { type: String, default: null },
  status: { 
    type: String, 
    enum: ['processing', 'ready', 'failed'], 
    default: 'processing' 
  },
  source_payload: {
    text: String,
    url: String,
    file_name: String,
    file_type: String,
    file_size_bytes: Number,
  },
  ingestion: {
    chunk_count: { type: Number, default: 0 },
    embedding_model: { type: String, default: 'text-embedding-3-small' },
    vector_store: { 
      type: String, 
      enum: ['pinecone', 'weaviate', 'pgvector', 'chroma'],
      default: 'chroma'
    },
  },
  metadata: { type: Schema.Types.Mixed, default: {} },
  created_at_unix: { type: Number, required: true },
  updated_at_unix: { type: Number, required: true },
}, { timestamps: false }); // We use unix timestamps manually as per spec

// Create indexes
KnowledgeBaseDocumentSchema.index({ userId: 1 });
KnowledgeBaseDocumentSchema.index({ document_id: 1 });
KnowledgeBaseDocumentSchema.index({ status: 1 });

export default mongoose.model<IKnowledgeBaseDocument>('KnowledgeBaseDocument', KnowledgeBaseDocumentSchema);
