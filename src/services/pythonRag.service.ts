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
    elaborate?: boolean;
    skipHistory?: boolean;
    ecommerceCredentials?: {
      platform?: string;
      base_url?: string;
      api_key?: string;
      api_secret?: string;
      access_token?: string;
    };
  }): Promise<{
    query: string;
    answer: string;
    retrieved_docs: string[];
    context: string;
    thread_id: string;
    latency_ms?: number;
  }> {
    try {
      console.log(`[Python RAG] Chat query in collections:`, params.collectionNames);
      console.log(`[Python RAG] Collections count: ${params.collectionNames.length}`);
      
      // Build request body - provider and api_key are REQUIRED for LLM generation
      const requestBody: any = {
        query: params.query,
        collection_name: params.collectionNames.length > 0 ? params.collectionNames[0] : '', // For backward compatibility
        collection_names: params.collectionNames,
        top_k: params.topK || 5,
        thread_id: params.threadId || undefined,
        system_prompt: params.systemPrompt || undefined,
        elaborate: params.elaborate !== undefined ? params.elaborate : false,
        skip_history: params.skipHistory !== undefined ? params.skipHistory : false
      };
      
      // Remove undefined fields to keep payload clean
      Object.keys(requestBody).forEach(key => {
        if (requestBody[key] === undefined) {
          delete requestBody[key];
        }
      });

      // Include provider and api_key if provided (REQUIRED for LLM to generate answers)
      if (params.provider) {
        requestBody.provider = params.provider;
        console.log(`[Python RAG] Using LLM provider: ${params.provider}`);
      } else {
        console.warn(`[Python RAG] ⚠️  No provider specified - LLM generation may fail`);
      }
      
      if (params.apiKey) {
        requestBody.api_key = params.apiKey;
        console.log(`[Python RAG] API key provided: ${params.apiKey.substring(0, 10)}...`);
      } else {
        console.warn(`[Python RAG] ⚠️  No API key provided - LLM generation may fail`);
      }

      // Include e-commerce credentials if provided (OPTIONAL - for WooCommerce support)
      if (params.ecommerceCredentials && params.ecommerceCredentials.platform) {
        requestBody.ecommerce_credentials = params.ecommerceCredentials;
        console.log(`[Python RAG] ✅ E-commerce credentials included in payload:`, { 
          platform: params.ecommerceCredentials.platform,
          base_url: params.ecommerceCredentials.base_url,
          has_api_key: !!params.ecommerceCredentials.api_key,
          has_api_secret: !!params.ecommerceCredentials.api_secret
        });
      } else {
        console.log(`[Python RAG] ⚠️  No e-commerce credentials provided in params`);
        console.log(`[Python RAG] ecommerceCredentials value:`, params.ecommerceCredentials);
      }
      
      // Log the complete payload being sent
      console.log('\n========== PYTHON RAG - PAYLOAD BEING SENT ==========');
      console.log('[Python RAG] URL:', `${PYTHON_RAG_BASE_URL}/rag/chat`);
      console.log('[Python RAG] Request Body:', JSON.stringify({
        ...requestBody,
        api_key: requestBody.api_key ? `${requestBody.api_key.substring(0, 10)}...***` : undefined,
        ecommerce_credentials: requestBody.ecommerce_credentials ? {
          ...requestBody.ecommerce_credentials,
          api_key: requestBody.ecommerce_credentials.api_key ? `${requestBody.ecommerce_credentials.api_key.substring(0, 10)}...***` : undefined,
          api_secret: '***hidden***'
        } : undefined
      }, null, 2));
      console.log('==================================================\n');
      
      const response = await axios.post(`${PYTHON_RAG_BASE_URL}/rag/chat`, requestBody);

      console.log(`[Python RAG] Chat response received`);
      const data = response.data;

      // Log response for debugging
      console.log('\n========== PYTHON RAG - RESPONSE RECEIVED ==========');
      console.log('[Python RAG] Response Status:', response.status);
      console.log('[Python RAG] Has Answer:', !!data.answer);
      console.log('[Python RAG] Answer Length:', data.answer?.length || 0);
      console.log('[Python RAG] Answer Preview:', data.answer?.substring(0, 200) || 'NO ANSWER');
      console.log('[Python RAG] Has Retrieved Docs:', !!data.retrieved_docs);
      console.log('[Python RAG] Retrieved Docs Count:', data.retrieved_docs?.length || 0);
      console.log('[Python RAG] Has Context:', !!data.context);
      console.log('[Python RAG] Context Length:', data.context?.length || 0);
      console.log('[Python RAG] Thread ID:', data.thread_id);
      console.log('[Python RAG] Latency (ms):', data.latency_ms);
      
      // Check if no documents were retrieved
      if (!data.retrieved_docs || data.retrieved_docs.length === 0) {
        console.warn('[Python RAG] ⚠️  WARNING: No documents retrieved from collections:', params.collectionNames);
        console.warn('[Python RAG] ⚠️  This usually means:');
        console.warn('[Python RAG] ⚠️  1. The collection name(s) don\'t exist in the Python backend');
        console.warn('[Python RAG] ⚠️  2. The collection is empty (no data ingested)');
        console.warn('[Python RAG] ⚠️  3. The query doesn\'t match any documents in the collection');
      }
      console.log('==================================================\n');

      // Check if answer contains error message or is empty
      const isErrorAnswer = 
        !data.answer || 
        data.answer.trim() === '' ||
        data.answer.toLowerCase().includes('encountered an error') ||
        data.answer.toLowerCase().includes('error while generating') ||
        data.answer.toLowerCase().includes('please try again') ||
        data.answer.toLowerCase().includes("i don't have enough information") ||
        data.answer.toLowerCase().includes('i do not have enough information') ||
        data.answer.toLowerCase().includes('not enough information');

      // If LLM failed, try to generate clean fallback answer
      if (isErrorAnswer) {
        console.log('[Python RAG] ⚠️  LLM generation failed or returned error message');
        
        // Try to use context if available
        if (data.context && data.context.length > 100) {
          console.log('[Python RAG] Attempting to generate fallback from context...');
          const contextSentences = data.context
            .split(/[.!?]\s+/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 20 && s.length < 300)
            .filter((s: string) => !s.toLowerCase().includes('document') && !s.toLowerCase().includes('score'));
          
          if (contextSentences.length > 0) {
            data.answer = contextSentences.slice(0, 6).join('. ') + '.';
            console.log('[Python RAG] ✅ Fallback answer generated from context');
          }
        }
        
        // Try to use retrieved documents if available
        if ((!data.answer || data.answer.includes('encountered an error')) && data.retrieved_docs && data.retrieved_docs.length > 0) {
          console.log('[Python RAG] Attempting to generate fallback from retrieved documents...');
          data.answer = this.buildCleanAnswerFromDocs(data.retrieved_docs, params.query);
          console.log('[Python RAG] ✅ Fallback answer generated from retrieved documents');
        }
        
        // Final fallback if nothing worked
        if (!data.answer || data.answer.includes('encountered an error')) {
          console.log('[Python RAG] ⚠️  Could not generate fallback answer - no context or documents available');
          data.answer = "I'm having trouble generating a response right now. Please try rephrasing your question or check your API keys in Settings → API Keys.";
        }
      }

      return data;
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
   * Build clean, concise answer from retrieved documents
   * Removes document labels, metadata, and creates natural language summary
   */
  private buildCleanAnswerFromDocs(retrievedDocs: any[], query: string): string {
    if (!retrievedDocs || retrievedDocs.length === 0) {
      return "I couldn't find relevant information in the knowledge base to answer your question.";
    }

    // Extract text content from documents (handle both string and object formats)
    const extractText = (doc: any): string => {
      if (typeof doc === 'string') return doc;
      if (doc.text) return doc.text;
      if (doc.content) return doc.content;
      return JSON.stringify(doc);
    };

    // Get text from top 3 most relevant documents
    const texts = retrievedDocs
      .slice(0, 3)
      .map(extractText)
      .filter(Boolean);

    if (texts.length === 0) {
      return "I found some information but couldn't extract the content. Please try rephrasing your question.";
    }

    // Combine and clean text
    const combinedText = texts.join(' ');

    // Remove document labels, metadata, and formatting artifacts
    let cleanedText = combinedText
      .replace(/Document\s+\d+/gi, '')
      .replace(/\(from\s+[^)]+\)/gi, '')
      .replace(/Score:\s*[\d.]+/gi, '')
      .replace(/chunk_index:\s*\d+/gi, '')
      .replace(/source:\s*[^\n]+/gi, '')
      .replace(/collection:\s*[^\n]+/gi, '')
      .replace(/URL:\s*[^\s]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Split into sentences
    const sentences = cleanedText
      .split(/[.!?]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 300) // Filter out too short or too long sentences
      .filter(s => !s.toLowerCase().includes('document') && !s.toLowerCase().includes('score'));

    if (sentences.length === 0) {
      return "I found relevant information but couldn't format it properly. Please try asking your question differently.";
    }

    // Take first 4-6 sentences for concise answer
    const selectedSentences = sentences.slice(0, 6);
    let answer = selectedSentences.join('. ');

    // Ensure it ends with proper punctuation
    if (!answer.match(/[.!?]$/)) {
      answer += '.';
    }

    // Limit total length to ~500 characters for concise response
    if (answer.length > 500) {
      const truncated = answer.substring(0, 497);
      const lastPeriod = truncated.lastIndexOf('.');
      answer = lastPeriod > 0 ? truncated.substring(0, lastPeriod + 1) : truncated + '...';
    }

    return answer;
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