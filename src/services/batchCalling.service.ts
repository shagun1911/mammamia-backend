import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

// Use PYTHON_API_URL if available (for elvenlabs-voiceagent), otherwise fall back to COMM_API_URL
// This ensures consistency - if PYTHON_API_URL is set, use it for all Python API calls
const COMM_API_URL = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

export interface BatchCallRecipient {
  phone_number: string;
  name: string;
  email?: string;
  dynamic_variables?: Record<string, any>;
}

export interface BatchCallRequest {
  agent_id: string;
  call_name: string;
  recipients: BatchCallRecipient[];
  retry_count?: number;
  sender_email?: string;
  phone_number_id?: string; // Internal phone number ID - will be resolved to ElevenLabs ID
  ecommerce_credentials?: {
    platform?: string;
    base_url?: string;
    api_key?: string;
    api_secret?: string;
    access_token?: string;
  };
}

export interface BatchCallResponse {
  id: string;
  name: string;
  agent_id: string;
  status: string;
  phone_number_id: string;
  phone_provider: string;
  created_at_unix: number;
  scheduled_time_unix: number;
  timezone: string;
  total_calls_dispatched: number;
  total_calls_scheduled: number;
  total_calls_finished: number;
  last_updated_at_unix: number;
  retry_count: number;
  agent_name: string;
}

export interface BatchCallResult {
  [key: string]: any;
}

export interface BatchJobCallsResponse {
  calls: BatchCallResult[];
  cursor?: string;
}

export class BatchCallingService {
  /**
   * Submit batch calling job
   * Calls Python /api/v1/batch-calling/submit endpoint
   */
  async submitBatchCall(data: BatchCallRequest): Promise<BatchCallResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/batch-calling/submit`;
      
      console.log('[Batch Calling Service] ===== SUBMITTING BATCH CALL =====');
      console.log('[Batch Calling Service] Python API URL:', pythonUrl);
      console.log('[Batch Calling Service] Request payload:', {
        agent_id: data.agent_id,
        call_name: data.call_name,
        recipients_count: data.recipients.length,
        retry_count: data.retry_count || 0,
        sender_email: data.sender_email,
        has_ecommerce: !!data.ecommerce_credentials
      });
      
      // Validate phone_number_id is provided and is a non-empty string
      if (!data.phone_number_id || typeof data.phone_number_id !== 'string' || data.phone_number_id.trim() === '') {
        console.error('[Batch Calling Service] ❌ phone_number_id validation failed:', {
          provided: data.phone_number_id,
          type: typeof data.phone_number_id,
          isEmpty: !data.phone_number_id || data.phone_number_id.trim() === ''
        });
        throw new AppError(
          400,
          'BATCH_CALL_ERROR',
          'phone_number_id is required and must be a non-empty string'
        );
      }

      // Build payload - ensure phone_number_id is included and properly formatted
      // Python API requires phone_number_id (ElevenLabs phone number ID)
      const phoneNumberId = String(data.phone_number_id).trim();
      
      // Format recipients with dynamic_variables structure
      const formattedRecipients = data.recipients.map((recipient, index) => {
        const formatted: any = {
          phone_number: recipient.phone_number,
          name: recipient.name
        };
        
        if (recipient.email) {
          formatted.email = recipient.email;
        }
        
        // PRIORITY: If dynamic_variables is explicitly provided from frontend, use it
        if (recipient.dynamic_variables && typeof recipient.dynamic_variables === 'object') {
          formatted.dynamic_variables = recipient.dynamic_variables;
          console.log(`[Batch Calling Service] ✅ Using explicit dynamic_variables for recipient ${index + 1}:`, formatted.dynamic_variables);
        } else {
          // Fallback: Extract dynamic_variables from recipient (any fields that aren't phone_number, name, or email)
          const dynamicVars: Record<string, any> = {};
          Object.keys(recipient).forEach(key => {
            if (key !== 'phone_number' && key !== 'name' && key !== 'email' && key !== 'dynamic_variables') {
              dynamicVars[key] = (recipient as any)[key];
            }
          });
          
          if (Object.keys(dynamicVars).length > 0) {
            formatted.dynamic_variables = dynamicVars;
            console.log(`[Batch Calling Service] ✅ Extracted dynamic_variables for recipient ${index + 1}:`, formatted.dynamic_variables);
          } else {
            console.log(`[Batch Calling Service] ⚠️  No dynamic_variables found for recipient ${index + 1}. Available keys:`, Object.keys(recipient));
          }
        }
        
        return formatted;
      });
      
      // Log formatted recipients to verify dynamic_variables are included
      console.log('[Batch Calling Service] 📋 Formatted recipients with dynamic_variables:');
      formattedRecipients.forEach((recipient, idx) => {
        console.log(`  Recipient ${idx + 1}:`, {
          name: recipient.name,
          phone: recipient.phone_number,
          email: recipient.email || 'N/A',
          has_dynamic_variables: !!recipient.dynamic_variables,
          dynamic_variables: recipient.dynamic_variables || {}
        });
      });
      
      // Python/ElevenLabs API expects agent_phone_number_id (official API uses this key)
      const payload: Record<string, any> = {
        agent_id: data.agent_id,
        call_name: data.call_name,
        recipients: formattedRecipients,
        retry_count: data.retry_count || 0,
        agent_phone_number_id: phoneNumberId, // Required by ElevenLabs batch-calling API
        phone_number_id: phoneNumberId // Send both for compatibility with different API versions
      };
      
      // Add optional fields only if they exist
      if (data.sender_email) {
        payload.sender_email = data.sender_email;
      }
      
      if (data.ecommerce_credentials) {
        payload.ecommerce_credentials = data.ecommerce_credentials;
      }
      
      // 🔥 COMPLETE PAYLOAD LOGGING - FULL DETAILS
      console.log('\n========================================');
      console.log('[Batch Calling Service] 🚀 COMPLETE BATCH CALL PAYLOAD:');
      console.log('========================================');
      console.log(JSON.stringify(payload, null, 2));
      console.log('========================================');
      console.log('[Batch Calling Service] Payload Summary:');
      console.log(`  - Agent ID: ${payload.agent_id}`);
      console.log(`  - Call Name: ${payload.call_name}`);
      console.log(`  - Recipients Count: ${payload.recipients.length}`);
      console.log(`  - Phone Number ID: ${payload.phone_number_id}`);
      console.log(`  - Retry Count: ${payload.retry_count}`);
      console.log(`  - Sender Email: ${payload.sender_email || 'N/A'}`);
      console.log(`  - Has Ecommerce: ${!!payload.ecommerce_credentials}`);
      console.log('\n[Batch Calling Service] Recipients Details:');
      payload.recipients.forEach((recipient: any, idx: number) => {
        console.log(`  Recipient ${idx + 1}:`);
        console.log(`    - Name: ${recipient.name}`);
        console.log(`    - Phone: ${recipient.phone_number}`);
        console.log(`    - Email: ${recipient.email || 'N/A'}`);
        if (recipient.dynamic_variables) {
          console.log(`    - Dynamic Variables:`, JSON.stringify(recipient.dynamic_variables, null, 6));
        } else {
          console.log(`    - Dynamic Variables: NONE`);
        }
      });
      console.log('========================================\n');
      
      // Ensure phone_number_id is at the top level and is a valid string
      if (!payload.phone_number_id || payload.phone_number_id === 'undefined' || payload.phone_number_id === 'null') {
        console.error('[Batch Calling Service] ❌ phone_number_id is invalid:', payload.phone_number_id);
        throw new AppError(
          400,
          'BATCH_CALL_ERROR',
          'phone_number_id is required and must be a valid ElevenLabs phone number ID'
        );
      }
      
      // Double-check phone_number_id is in payload
      if (!payload.phone_number_id) {
        console.error('[Batch Calling Service] ❌ phone_number_id missing from payload after construction!');
        throw new AppError(
          500,
          'BATCH_CALL_ERROR',
          'Internal error: phone_number_id was not included in payload'
        );
      }

      // Make the request - ensure phone_number_id is definitely in the payload
      console.log('[Batch Calling Service] Making POST request to:', pythonUrl);
      console.log('[Batch Calling Service] Final payload check - phone_number_id:', payload.phone_number_id);
      console.log('[Batch Calling Service] Final payload check - phone_number_id type:', typeof payload.phone_number_id);
      console.log('[Batch Calling Service] Final payload check - phone_number_id length:', payload.phone_number_id?.length);
      
      const response = await axios.post<BatchCallResponse>(
        pythonUrl,
        payload,
        {
          timeout: 60000, // 60 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Batch Calling Service] ✅ Batch call submitted successfully');
      console.log('[Batch Calling Service] Response status:', response.status);
      console.log('[Batch Calling Service] Response body:');
      console.log(JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to submit batch call:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to submit batch call'
      );
    }
  }

  /**
   * Get batch job status
   * Calls Python /api/v1/batch-calling/{job_id} endpoint
   */
  async getBatchJobStatus(jobId: string): Promise<BatchCallResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/batch-calling/${jobId}`;
      
      console.log('[Batch Calling Service] ===== GETTING BATCH JOB STATUS =====');
      console.log('[Batch Calling Service] Python API URL:', pythonUrl);
      console.log('[Batch Calling Service] Job ID:', jobId);
      
      const response = await axios.get<BatchCallResponse>(
        pythonUrl,
        {
          timeout: 30000, // 30 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Batch Calling Service] ✅ Batch job status fetched successfully');
      console.log('[Batch Calling Service] Response status:', response.status);
      console.log('[Batch Calling Service] Response body:', JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to get batch job status:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to get batch job status'
      );
    }
  }

  /**
   * Cancel batch job
   * Calls Python /api/v1/batch-calling/{job_id}/cancel endpoint
   */
  async cancelBatchJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/batch-calling/${jobId}/cancel`;
      
      console.log('[Batch Calling Service] ===== CANCELLING BATCH JOB =====');
      console.log('[Batch Calling Service] Python API URL:', pythonUrl);
      console.log('[Batch Calling Service] Job ID:', jobId);
      
      const response = await axios.post<{ success: boolean; message: string }>(
        pythonUrl,
        {},
        {
          timeout: 30000, // 30 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Batch Calling Service] ✅ Batch job cancelled successfully');
      console.log('[Batch Calling Service] Response status:', response.status);
      console.log('[Batch Calling Service] Response body:', JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to cancel batch job:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to cancel batch job'
      );
    }
  }

  /**
   * Get batch job calls (individual call results)
   * Calls Python /api/v1/batch-calling/{job_id}/calls endpoint
   * If endpoint doesn't exist (404), returns empty result gracefully
   */
  async getBatchJobCalls(
    jobId: string,
    options?: {
      status?: string;
      cursor?: string;
      page_size?: number;
    }
  ): Promise<BatchJobCallsResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/batch-calling/${jobId}/calls`;
      
      console.log('[Batch Calling Service] ===== GETTING BATCH JOB CALLS =====');
      console.log('[Batch Calling Service] Python API URL:', pythonUrl);
      console.log('[Batch Calling Service] Job ID:', jobId);
      console.log('[Batch Calling Service] Options:', options);
      
      const params: Record<string, any> = {};
      if (options?.status) params.status = options.status;
      if (options?.cursor) params.cursor = options.cursor;
      if (options?.page_size) params.page_size = options.page_size;
      
      const response = await axios.get<BatchJobCallsResponse>(
        pythonUrl,
        {
          params,
          timeout: 30000, // 30 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Batch Calling Service] ✅ Batch job calls fetched successfully');
      console.log('[Batch Calling Service] Response status:', response.status);
      console.log('[Batch Calling Service] Calls count:', response.data.calls?.length || 0);
      
      return response.data;
    } catch (error: any) {
      // Handle 404 gracefully - endpoint might not be implemented yet
      if (error.response?.status === 404) {
        console.warn('[Batch Calling Service] ⚠️  Batch job calls endpoint not found (404). This endpoint may not be implemented in the Python API yet.');
        console.warn('[Batch Calling Service] Returning empty result. Endpoint:', `${COMM_API_URL}/api/v1/batch-calling/${jobId}/calls`);
        
        // Return empty result instead of throwing error
        return {
          calls: [],
          cursor: undefined
        };
      }
      
      console.error('[Batch Calling Service] ❌ Failed to get batch job calls:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to get batch job calls'
      );
    }
  }
}

export const batchCallingService = new BatchCallingService();
