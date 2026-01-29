import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

// Use PYTHON_API_URL if available (for elvenlabs-voiceagent), otherwise fall back to COMM_API_URL
// This ensures consistency - if PYTHON_API_URL is set, use it for all Python API calls
const COMM_API_URL = process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

export interface BatchCallRecipient {
  phone_number: string;
  name: string;
  email?: string;
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
      
      const payload: Record<string, any> = {
        agent_id: data.agent_id,
        call_name: data.call_name,
        recipients: data.recipients,
        retry_count: data.retry_count || 0,
        phone_number_id: phoneNumberId // Required - must be ElevenLabs phone_number_id
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
}

export const batchCallingService = new BatchCallingService();
