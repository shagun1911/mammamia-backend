import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { AppError } from '../middleware/error.middleware';

/**
 * RAG Service - Integrates with Python RAG API (localhost:8000)
 * Handles knowledge base operations: collection creation, data ingestion, and chat
 */
export class RAGService {
  private client: AxiosInstance;
  private ragApiUrl: string;

  constructor() {
    this.ragApiUrl = process.env.RAG_API_URL || 'http://localhost:8000';
    this.client = axios.create({
      baseURL: this.ragApiUrl,
      timeout: 300000, // 5 minutes for data ingestion
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[RAG Service] Initialized with base URL: ${this.ragApiUrl}`);
  }

  /**
   * Create a new collection in the RAG system
   * @param collectionName Unique name for the collection
   */
  async createCollection(collectionName: string) {
    try {
      console.log(`[RAG Service] Creating collection: ${collectionName}`);
      
      const response = await this.client.post('/rag/create_collection', {
        collection_name: collectionName,
      });

      console.log(`[RAG Service] ✅ Collection created: ${collectionName}`);
      return response.data;
    } catch (error: any) {
      console.error(`[RAG Service] ❌ Failed to create collection:`, error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'RAG_COLLECTION_ERROR',
        error.response?.data?.detail || error.message || 'Failed to create RAG collection'
      );
    }
  }

  /**
   * Ingest data into a collection (URLs, PDFs, Excel files)
   * @param collectionName Target collection
   * @param data Ingestion data (URLs, files)
   */
  async ingestData(params: {
    collectionName: string;
    urlLinks?: string[];
    pdfFiles?: Buffer[];
    excelFiles?: Buffer[];
  }) {
    try {
      const { collectionName, urlLinks, pdfFiles, excelFiles } = params;
      console.log(`[RAG Service] Starting data ingestion for collection: ${collectionName}`);

      const formData = new FormData();
      formData.append('collection_name', collectionName);

      // Add URL links if provided
      if (urlLinks && urlLinks.length > 0) {
        formData.append('url_links', urlLinks.join(','));
        console.log(`[RAG Service] Added ${urlLinks.length} URLs`);
      }

      // Add PDF files if provided
      if (pdfFiles && pdfFiles.length > 0) {
        pdfFiles.forEach((pdfBuffer, index) => {
          formData.append('pdf_files', pdfBuffer, `document_${index}.pdf`);
        });
        console.log(`[RAG Service] Added ${pdfFiles.length} PDF files`);
      }

      // Add Excel files if provided
      if (excelFiles && excelFiles.length > 0) {
        excelFiles.forEach((excelBuffer, index) => {
          formData.append('excel_files', excelBuffer, `spreadsheet_${index}.xlsx`);
        });
        console.log(`[RAG Service] Added ${excelFiles.length} Excel files`);
      }

      const response = await this.client.post('/rag/data_ingestion', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      console.log(`[RAG Service] ✅ Data ingestion completed for: ${collectionName}`);
      return response.data;
    } catch (error: any) {
      console.error(`[RAG Service] ❌ Data ingestion failed:`, error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'RAG_INGESTION_ERROR',
        error.response?.data?.detail || error.message || 'Failed to ingest data into RAG'
      );
    }
  }

  /**
   * Query the RAG system for chat responses
   * @param query User query
   * @param collectionName Collection to search
   * @param systemPrompt Optional system prompt (combines knowledge base + agent prompt)
   * @param threadId Optional thread ID for conversation memory
   * @param topK Number of documents to retrieve (default: 5)
   */
  async chat(params: {
    query: string;
    collectionName: string;
    systemPrompt?: string;
    threadId?: string;
    topK?: number;
  }) {
    try {
      const { query, collectionName, systemPrompt, threadId, topK = 5 } = params;
      console.log(`[RAG Service] Chat query for collection: ${collectionName}`);

      const response = await this.client.post('/rag/chat', {
        query,
        collection_name: collectionName,
        top_k: topK,
        thread_id: threadId,
        system_prompt: systemPrompt,
      });

      console.log(`[RAG Service] ✅ Chat response generated`);
      return response.data;
    } catch (error: any) {
      console.error(`[RAG Service] ❌ Chat query failed:`, error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'RAG_CHAT_ERROR',
        error.response?.data?.detail || error.message || 'Failed to get chat response from RAG'
      );
    }
  }

  /**
   * Health check for RAG API
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return { status: 'healthy', ...response.data };
    } catch (error: any) {
      console.error('[RAG Service] Health check failed:', error.message);
      return { status: 'unhealthy', error: error.message };
    }
  }
}

export const ragService = new RAGService();

