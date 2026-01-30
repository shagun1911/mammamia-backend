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
      // CRITICAL: first_message uses {{name}} - ElevenLabs requires name in dynamic_variables
      // or the call terminates with "Missing required dynamic variables"
      const formattedRecipients = data.recipients.map(recipient => {
        const formatted: any = {
          phone_number: recipient.phone_number,
          name: recipient.name
        };
        
        if (recipient.email) {
          formatted.email = recipient.email;
        }
        
        // Build dynamic_variables: ALWAYS include name (and customer_name alias) so {{name}} in first_message works
        const dynamicVars: Record<string, any> = { ...(recipient.dynamic_variables || {}) };
        if (recipient.name) {
          dynamicVars.name = recipient.name;
          dynamicVars.customer_name = recipient.name; // alias for email template confirm_appointment
        }
        if (recipient.email) {
          dynamicVars.email = recipient.email;
        }
        // Include any extra recipient fields
        Object.keys(recipient).forEach(key => {
          if (key !== 'phone_number' && key !== 'name' && key !== 'email' && key !== 'dynamic_variables') {
            dynamicVars[key] = (recipient as any)[key];
          }
        });
        formatted.dynamic_variables = dynamicVars;
        
        return formatted;
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

      console.log('[Batch Calling Service] Request payload:', {
        agent_id: payload.agent_id,
        call_name: payload.call_name,
        recipients_count: payload.recipients.length,
        retry_count: payload.retry_count,
        sender_email: payload.sender_email,
        phone_number_id: payload.phone_number_id,
        has_ecommerce: !!payload.ecommerce_credentials
      });
      
      // Log the exact payload being sent
      console.log('[Batch Calling Service] Full payload being sent to Python API:', JSON.stringify(payload, null, 2));

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
