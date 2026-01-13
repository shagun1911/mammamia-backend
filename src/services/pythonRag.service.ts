import axios from 'axios';
import FormData from 'form-data';
import { AppError } from '../middleware/error.middleware';

// Remove trailing slash from URL if present
const PYTHON_RAG_BASE_URL = 'https://keplerov1-python-2.onrender.com';

/**
 * Python RAG Service
 * Integrates with Python RAG backend running on port 8000
 */
export class PythonRagService {
  /**
   * Create a new collection in the RAG system
   */
  async createCollection(collectionName: string): Promise<any> {
    try {
      console.log(`[Python RAG] Creating collection: ${collectionName}`);
      
      const response = await axios.post(`${PYTHON_RAG_BASE_URL}/rag/create_collection`, {
        collection_name: collectionName
      });

      console.log(`[Python RAG] Collection created successfully: ${collectionName}`);
      return response.data;
    } catch (error: any) {
      console.error('[Python RAG] Failed to create collection:', error.response?.data || error.message);
      throw new AppError(
        500,
        'RAG_COLLECTION_ERROR',
        `Failed to create RAG collection: ${error.response?.data?.detail || error.message}`
      );
    }
  }

  /**
   * Delete a collection from the RAG system
   */
  async deleteCollection(collectionName: string): Promise<any> {
    try {
      console.log(`[Python RAG] Deleting collection: ${collectionName}`);
      
      const response = await axios.delete(`${PYTHON_RAG_BASE_URL}/rag/delete_collection`, {
        data: {
          collection_name: collectionName
        }
      });

      console.log(`[Python RAG] Collection deleted successfully: ${collectionName}`);
      return response.data;
    } catch (error: any) {
      console.error('[Python RAG] Failed to delete collection:', error.response?.data || error.message);
      throw new AppError(
        500,
        'RAG_COLLECTION_ERROR',
        `Failed to delete RAG collection: ${error.response?.data?.detail || error.message}`
      );
    }
  }

  /**
   * Ingest data into a collection
   * Supports URLs, PDFs, and Excel files
   */
  async ingestData(params: {
    collectionName: string;
    urlLinks?: string[];
    pdfFiles?: Buffer[];
    excelFiles?: Buffer[];
  }): Promise<any> {
    try {
      const url = `${PYTHON_RAG_BASE_URL}/rag/data_ingestion`;
      console.log(`[Python RAG] Ingesting data into collection: ${params.collectionName}`);
      console.log(`[Python RAG] API URL: ${url}`);
      console.log(`[Python RAG] Data sources:`, {
        urlLinks: params.urlLinks?.length || 0,
        pdfFiles: params.pdfFiles?.length || 0,
        excelFiles: params.excelFiles?.length || 0
      });
      
      const formData = new FormData();
      formData.append('collection_name', params.collectionName);

      // Add URL links as comma-separated string
      if (params.urlLinks && params.urlLinks.length > 0) {
        const urlLinksStr = params.urlLinks.join(',');
        formData.append('url_links', urlLinksStr);
        console.log(`[Python RAG] Adding URL links: ${urlLinksStr}`);
      }

      // Add PDF files
      if (params.pdfFiles && params.pdfFiles.length > 0) {
        params.pdfFiles.forEach((fileBuffer, index) => {
          formData.append('pdf_files', fileBuffer, `file_${index}.pdf`);
        });
        console.log(`[Python RAG] Adding ${params.pdfFiles.length} PDF files`);
      }

      // Add Excel files
      if (params.excelFiles && params.excelFiles.length > 0) {
        params.excelFiles.forEach((fileBuffer, index) => {
          formData.append('excel_files', fileBuffer, `file_${index}.xlsx`);
        });
        console.log(`[Python RAG] Adding ${params.excelFiles.length} Excel files`);
      }

      console.log(`[Python RAG] Sending POST request to: ${url}`);
      
      const response = await axios.post(
        url,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          },
          timeout: 60000 // 60 second timeout
        }
      );

      console.log(`[Python RAG] ✅ Data ingestion completed for: ${params.collectionName}`);
      console.log(`[Python RAG] Response:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error('[Python RAG] ❌ Failed to ingest data');
      console.error('[Python RAG] Error status:', error.response?.status);
      console.error('[Python RAG] Error data:', error.response?.data);
      console.error('[Python RAG] Error message:', error.message);
      console.error('[Python RAG] Request URL:', error.config?.url);
      
      throw new AppError(
        500,
        'RAG_INGESTION_ERROR',
        `Failed to ingest data: ${error.response?.data?.detail || error.message}`
      );
    }
  }

  /**
   * Chat with RAG system
   * Uses LangGraph workflow with retrieval and generation
   * Supports multiple collections for cross-knowledge-base search
   */
  async chat(params: {
    query: string;
    collectionNames: string[]; // Updated to support multiple collections
    topK?: number;
    threadId?: string;
    systemPrompt?: string;
    provider?: string;
    apiKey?: string;
  }): Promise<{
    query: string;
    answer: string;
    retrieved_docs: string[];
    context: string;
    thread_id: string;
  }> {
    try {
      console.log(`[Python RAG] Chat query in collections:`, params.collectionNames);
      console.log(`[Python RAG] Collections count: ${params.collectionNames.length}`);
      
      const response = await axios.post(`${PYTHON_RAG_BASE_URL}/rag/chat`, {
        query: params.query,
        collection_names: params.collectionNames, // Updated to support multiple collections
        top_k: params.topK || 5,
        thread_id: params.threadId,
        system_prompt: params.systemPrompt,
        provider: params.provider,
        api_key: params.apiKey
      });

      console.log(`[Python RAG] Chat response received`);
      return response.data;
    } catch (error: any) {
      console.error('[Python RAG] Failed to chat:', error.response?.data || error.message);
      throw new AppError(
        500,
        'RAG_CHAT_ERROR',
        `Failed to process chat: ${error.response?.data?.detail || error.message}`
      );
    }
  }

  /**
   * Health check for Python RAG service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${PYTHON_RAG_BASE_URL}/health`, { timeout: 5000 });
      return true;
    } catch (error) {
      console.error('[Python RAG] Health check failed:', error);
      return false;
    }
  }
}

export const pythonRagService = new PythonRagService();

