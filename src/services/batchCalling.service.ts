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
      
      // Import utility function for building dynamic variables
      const { buildDynamicVariables } = await import('../utils/dynamicVariables.util');

      // Format recipients with dynamic_variables structure
      // CRITICAL: ElevenLabs needs name, customer_name, email for first_message and appointment/booking tools
      const formattedRecipients = data.recipients.map((recipient, index) => {
        const formatted: any = {
          phone_number: recipient.phone_number,
          name: recipient.name || 'Customer'
        };
        
        if (recipient.email) {
          formatted.email = recipient.email;
        }
        
        // Build dynamic_variables by merging customer_info (name, email) and explicit dynamic_variables
        const customerInfo: Record<string, any> = {
          name: recipient.name,
          email: recipient.email
        };
        
        // Also include any other fields from recipient as part of customer_info
        Object.keys(recipient).forEach(key => {
          if (key !== 'phone_number' && key !== 'name' && key !== 'email' && key !== 'dynamic_variables') {
            customerInfo[key] = (recipient as any)[key];
          }
        });
        
        const dynamicVars = buildDynamicVariables(
          customerInfo,
          recipient.dynamic_variables
        );
        
        // ALWAYS include dynamic_variables (never omit)
        formatted.dynamic_variables = dynamicVars;
        
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
        // Defensive logging for dynamic variables
        console.log(
          `[Dynamic Variables] Recipient ${idx + 1} final variables:`,
          JSON.stringify(recipient.dynamic_variables, null, 2)
        );
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

  /**
   * Get batch job results with transcripts
   * Calls Python /api/v1/batch-calling/{job_id}/results endpoint
   */
  async getBatchJobResults(
    jobId: string,
    includeTranscript: boolean = true
  ): Promise<any> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/batch-calling/${jobId}/results`;
      
      console.log('[Batch Calling Service] ===== GETTING BATCH JOB RESULTS =====');
      console.log('[Batch Calling Service] Python API URL:', pythonUrl);
      console.log('[Batch Calling Service] Job ID:', jobId);
      console.log('[Batch Calling Service] Include Transcript:', includeTranscript);
      
      const params: Record<string, any> = {};
      if (includeTranscript !== undefined) {
        params.include_transcript = includeTranscript;
      }
      
      const response = await axios.get<any>(
        pythonUrl,
        {
          params,
          timeout: 60000, // 60 seconds timeout (transcripts can be large)
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Batch Calling Service] ✅ Batch job results fetched successfully');
      console.log('[Batch Calling Service] Response status:', response.status);
      
      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to get batch job results:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to get batch job results'
      );
    }
  }

  /**
   * Sync batch call results to Conversations
   * Creates Conversation records for each call result
   * Idempotent - safe to call multiple times
   */
  async syncBatchCallConversations(jobId: string, organizationId: string): Promise<void> {
    try {
      console.log('[Batch Calling Service] ===== SYNCING BATCH CALL CONVERSATIONS =====');
      console.log('[Batch Calling Service] Job ID:', jobId);
      
      // Fetch results with transcripts from Python API
      const results = await this.getBatchJobResults(jobId, true);
      
      if (!results.results || !Array.isArray(results.results)) {
        console.warn('[Batch Calling Service] ⚠️ No results found in response');
        return;
      }

      const Conversation = (await import('../models/Conversation')).default;
      const Customer = (await import('../models/Customer')).default;
      const Message = (await import('../models/Message')).default;
      const BatchCall = (await import('../models/BatchCall')).default;
      const mongoose = (await import('mongoose')).default;

      // Get batch call info for userId
      const batchCall = await BatchCall.findOne({ batch_call_id: jobId }).lean();
      if (!batchCall) {
        console.error('[Batch Calling Service] ❌ Batch call not found in database');
        return;
      }

      const orgObjectId = new mongoose.Types.ObjectId(organizationId);
      const userId = batchCall.userId?.toString() || organizationId;

      let conversationsCreated = 0;
      let conversationsSkipped = 0;

      // Process each call result
      for (const callResult of results.results) {
        try {
          const phoneNumber = callResult.phone_number;
          const dynamicVars = callResult.dynamic_variables || {};
          const customerName = dynamicVars.name || dynamicVars.customer_name || 'Unknown';
          const customerEmail = dynamicVars.email;
          const conversationId = callResult.conversation_id;
          const transcript = callResult.transcript;

          // CRITICAL: Prevent duplicates - check if conversation already exists
          const exists = await Conversation.findOne({
            organizationId: orgObjectId,
            channel: 'phone',
            'metadata.batch_call_id': jobId,
            'metadata.phone_number': phoneNumber
          });

          if (exists) {
            console.log(`[Batch Calling Service] ⚠️ Conversation already exists for ${phoneNumber}, skipping`);
            conversationsSkipped++;
            continue;
          }

          // Find or create customer
          let customer = await Customer.findOne({
            phone: phoneNumber,
            organizationId: orgObjectId
          });

          if (!customer) {
            customer = await Customer.create({
              name: customerName,
              phone: phoneNumber,
              email: customerEmail,
              organizationId: orgObjectId,
              source: 'phone',
              color: `#${Math.floor(Math.random() * 16777215).toString(16)}`
            });
            console.log(`[Batch Calling Service] ✅ Created customer: ${customer.name} (${customer.phone})`);
          } else {
            // Update customer info if we have better data
            if (customerName !== 'Unknown' && customer.name === 'Unknown') {
              customer.name = customerName;
            }
            if (customerEmail && !customer.email) {
              customer.email = customerEmail;
            }
            await customer.save();
          }

          // Create conversation using the same pattern as outbound calls
          const conversation = await Conversation.create({
            organizationId: orgObjectId,
            customerId: customer._id,
            channel: 'phone',
            status: callResult.call_successful ? 'closed' : 'open',
            transcript: transcript || undefined,
            isAiManaging: true,
            unread: false,
            metadata: {
              batch_call_id: jobId,
              conversation_id: conversationId,
              recipient_id: callResult.recipient_id,
              phone_number: phoneNumber,
              callerId: conversationId, // For transcript polling compatibility
              duration_seconds: callResult.duration_seconds,
              call_successful: callResult.call_successful,
              end_reason: callResult.end_reason,
              callInitiated: new Date(callResult.duration_seconds ? Date.now() - (callResult.duration_seconds * 1000) : Date.now()),
              callCompletedAt: new Date(),
              source: 'batch'
            }
          });

          console.log(`[Batch Calling Service] ✅ Created conversation ${conversation._id} for ${customerName}`);

          // Create messages from transcript if available
          if (transcript && Array.isArray(transcript) && transcript.length > 0) {
            const messages: any[] = [];
            for (const transcriptEntry of transcript) {
              const role = transcriptEntry.role;
              const messageText = transcriptEntry.message;

              if (!messageText || !messageText.trim()) {
                continue;
              }

              // Map roles: 'agent' -> 'ai', 'user' -> 'customer'
              let sender: 'customer' | 'ai' = 'customer';
              if (role === 'agent' || role === 'assistant') {
                sender = 'ai';
              } else if (role === 'user' || role === 'customer') {
                sender = 'customer';
              }

              messages.push({
                conversationId: conversation._id,
                sender,
                text: messageText.trim(),
                type: 'message',
                attachments: [],
                sourcesUsed: [],
                topics: [],
                timestamp: new Date(),
                metadata: {
                  transcriptItemId: `${callResult.recipient_id}_${messages.length}`,
                  fromBatchCall: true
                }
              });
            }

            // Save all messages
            if (messages.length > 0) {
              await Message.insertMany(messages);
              console.log(`[Batch Calling Service] ✅ Created ${messages.length} messages for conversation ${conversation._id}`);
            }
          } else {
            // Add internal note if no transcript available
            await Message.create({
              conversationId: conversation._id,
              type: 'internal_note',
              text: `Batch call completed to ${customerName} (${phoneNumber}). ${callResult.call_successful ? 'Call was successful.' : 'Call failed.'}`,
              sender: 'ai',
              timestamp: new Date()
            });
          }

          conversationsCreated++;
        } catch (resultError: any) {
          console.error(`[Batch Calling Service] ❌ Failed to create conversation for ${callResult.phone_number}:`, resultError.message);
          // Continue processing other results
        }
      }

      // Mark batch call as synced
      await BatchCall.updateOne(
        { batch_call_id: jobId },
        { $set: { conversations_synced: true } }
      );

      console.log(`[Batch Calling Service] ✅ Synced batch call conversations: ${conversationsCreated} created, ${conversationsSkipped} skipped`);
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Error syncing batch call conversations:', error.message);
      throw error; // Re-throw so caller can handle
    }
  }
}

export const batchCallingService = new BatchCallingService();
