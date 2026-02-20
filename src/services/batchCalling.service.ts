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
  phone_number_id: string; // ElevenLabs phone number ID
  recipients: BatchCallRecipient[];
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
        phone_number_id: data.phone_number_id,
        recipients_count: data.recipients.length
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

      // Build payload with EXACTLY the required fields - no transformations, no enrichment
      // Preserve recipients exactly as received, including dynamic_variables as-is
      const payload = {
        agent_id: data.agent_id,
        call_name: data.call_name,
        phone_number_id: String(data.phone_number_id).trim(),
        recipients: data.recipients.map((recipient) => {
          const recipientPayload: any = {
            phone_number: recipient.phone_number,
            name: recipient.name
          };
          // Include email if provided
          if (recipient.email) {
            recipientPayload.email = recipient.email;
          }
          // Include dynamic_variables ONLY if provided (preserve exactly as received)
          if (recipient.dynamic_variables !== undefined && recipient.dynamic_variables !== null) {
            recipientPayload.dynamic_variables = recipient.dynamic_variables;
          }
          return recipientPayload;
        })
      };

      // Log complete payload before submitting
      console.log('\n========================================');
      console.log('[Batch Calling Service] 🚀 COMPLETE BATCH CALL PAYLOAD:');
      console.log('========================================');
      console.log(JSON.stringify(payload, null, 2));
      console.log('========================================');
      console.log('Recipients count:', payload.recipients.length);
      console.log('Agent ID:', payload.agent_id);
      console.log('Phone Number ID:', payload.phone_number_id);
      console.log('========================================\n');

      // Make the request
      console.log('[Batch Calling Service] Making POST request to:', pythonUrl);

      const response = await axios.post<BatchCallResponse>(
        pythonUrl,
        payload,
        {
          timeout: 600000, // 10 minutes timeout
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
      console.log('[Batch Calling Service] Job ID:', jobId);
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
          const customerEmail = dynamicVars.email || dynamicVars.customer_email;
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
            console.log(`[Batch Calling Service] ⚠️ Conversation already exists for ${phoneNumber}, triggering automation anyway`);
            conversationsSkipped++;
            // Ensure transcript is on the conversation so extraction has content (may have been created before transcript was ready)
            if (transcript != null && (
              (Array.isArray(transcript) && transcript.length > 0) ||
              (typeof transcript === 'string' && transcript.trim().length > 0) ||
              (transcript.messages && Array.isArray(transcript.messages) && transcript.messages.length > 0)
            )) {
              await Conversation.updateOne(
                { _id: exists._id },
                { $set: { transcript } }
              );
            }
            const hasEndReason = callResult.end_reason != null && String(callResult.end_reason).trim() !== '';
            const statusCompleted = callResult.status === 'completed';
            const callEnded = hasEndReason || statusCompleted;
            const hasTranscript = transcript != null && (
              (Array.isArray(transcript) && transcript.length > 0) ||
              (typeof transcript === 'string' && transcript.trim().length > 0) ||
              (transcript.messages && Array.isArray(transcript.messages) && transcript.messages.length > 0)
            );
            if (callEnded && hasTranscript) {
              try {
                const existingCustomer = await Customer.findById(exists.customerId).lean();
                const { automationService } = await import('./automation.service');
                await automationService.triggerByEvent('batch_call_completed', {
                  event: 'batch_call_completed',
                  batch_id: jobId,
                  conversation_id: exists._id.toString(),
                  contactId: (existingCustomer as any)?._id?.toString() || exists.customerId?.toString(),
                  organizationId: organizationId,
                  source: 'batch_call',
                  freshContactData: {
                    name: customerName,
                    email: customerEmail,
                    phone: phoneNumber
                  }
                }, {
                  userId: userId,
                  organizationId: organizationId
                });
                console.log(`[Batch Calling Service] 🚀 Triggered batch_call_completed automation for existing conversation ${exists._id}`);
              } catch (triggerError: any) {
                console.error(`[Batch Calling Service] ⚠️ Failed to trigger automation for existing conversation ${exists._id}:`, triggerError.message);
              }
            }
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
            // CRITICAL FIX: Always update customer info from CSV (batch call data is the source of truth)
            let customerUpdated = false;

            if (customerName !== 'Unknown' && customer.name !== customerName) {
              customer.name = customerName;
              customerUpdated = true;
            }

            // CRITICAL FIX: Always update email from CSV, even if customer already has an email
            // This ensures the LATEST CSV data is used, not old database data
            if (customerEmail && customer.email !== customerEmail) {
              console.log(`[Batch Calling Service] 📧 Updating email for ${customer.name}: ${customer.email} → ${customerEmail}`);
              customer.email = customerEmail;
              customerUpdated = true;
            }

            if (customerUpdated) {
              await customer.save();
              console.log(`[Batch Calling Service] ✅ Updated customer: ${customer.name} (${customer.phone})`);
            }
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
              recording_url: callResult.recording_url || callResult.audio_url, // CRITICAL: Add recording URL
              audio_url: callResult.recording_url || callResult.audio_url, // Alias for compatibility
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

          // Only trigger automation when the call has ended AND transcript is loaded (never trigger with empty transcript)
          const hasEndReason = callResult.end_reason != null && String(callResult.end_reason).trim() !== '';
          const statusCompleted = callResult.status === 'completed';
          const callEnded = hasEndReason || statusCompleted;
          const hasTranscript = transcript != null && (
            (Array.isArray(transcript) && transcript.length > 0) ||
            (typeof transcript === 'string' && transcript.trim().length > 0) ||
            (transcript.messages && Array.isArray(transcript.messages) && transcript.messages.length > 0)
          );
          if (!callEnded) {
            console.log(`[Batch Calling Service] ⏳ Skipping automation for ${phoneNumber} – call may not have ended yet (end_reason: ${callResult.end_reason || 'missing'}, status: ${callResult.status || 'missing'})`);
          } else if (!hasTranscript) {
            console.log(`[Batch Calling Service] ⏳ Skipping automation for ${phoneNumber} – no transcript loaded yet (trigger when transcript is available)`);
          }

          if (callEnded && hasTranscript) {
          try {
            const { automationService } = await import('./automation.service');

            // CRITICAL FIX: Pass fresh contact data from CSV in triggerData
            // This ensures automations use the LATEST email from CSV, not old database email
            await automationService.triggerByEvent('batch_call_completed', {
              event: 'batch_call_completed',
              batch_id: jobId,
              conversation_id: conversation._id.toString(),
              contactId: customer._id.toString(),
              organizationId: organizationId,
              source: 'batch_call',
              // CRITICAL: Include fresh contact data from CSV
              freshContactData: {
                name: customerName,
                email: customerEmail,
                phone: phoneNumber
              }
            }, {
              userId: userId,
              organizationId: organizationId
            });
            console.log(`[Batch Calling Service] 🚀 Triggered batch_call_completed automation for conversation ${conversation._id}`);
            console.log(`[Batch Calling Service] 📧 Using fresh email from CSV: ${customerEmail}`);
          } catch (triggerError: any) {
            console.error(`[Batch Calling Service] ⚠️ Failed to trigger automation for conversation ${conversation._id}:`, triggerError.message);
          }
          }
        } catch (resultError: any) {
          console.error(`[Batch Calling Service] ❌ Failed to create conversation for ${callResult.phone_number}:`, resultError.message);
          // Continue processing other results
        }
      }

      // Mark batch call as synced
      await BatchCall.updateOne(
        { batch_call_id: jobId },
        {
          $set: { conversations_synced: true },
          $unset: { syncErrorCount: "" }
        }
      );

      console.log(`[Batch Calling Service] ✅ Synced batch call conversations: ${conversationsCreated} created, ${conversationsSkipped} skipped`);
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Error syncing batch call conversations:', error.message);

      // Increment error count to prevent infinite retry loops
      const BatchCall = (await (import('../models/BatchCall'))).default;
      await BatchCall.updateOne(
        { batch_call_id: jobId },
        { $inc: { syncErrorCount: 1 } }
      );

      throw error; // Re-throw so caller can handle
    }
  }
}

export const batchCallingService = new BatchCallingService();
