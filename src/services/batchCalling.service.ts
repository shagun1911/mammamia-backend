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

      // Log summary only (do not log full payload – no PII in logs; cancelled batches must not leave contact data in logs)
      console.log('[Batch Calling Service] 🚀 Submitting batch:', {
        recipients_count: payload.recipients.length,
        agent_id: payload.agent_id,
        phone_number_id: payload.phone_number_id,
        call_name: payload.call_name
      });

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

      console.log('[Batch Calling Service] ✅ Batch call submitted successfully', {
        status: response.status,
        batch_id: response.data?.id,
        batch_status: response.data?.status
      });

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
      const response = await axios.get<BatchCallResponse>(
        `${COMM_API_URL}/api/v1/batch-calling/${jobId}`,
        { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to get batch status:', jobId, error.response?.data || error.message);
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
      console.log('[Batch Calling Service] Cancelling batch:', jobId);

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
      const params: Record<string, any> = {};
      if (options?.status) params.status = options.status;
      if (options?.cursor) params.cursor = options.cursor;
      if (options?.page_size) params.page_size = options.page_size;

      const response = await axios.get<BatchJobCallsResponse>(
        `${COMM_API_URL}/api/v1/batch-calling/${jobId}/calls`,
        { params, timeout: 30000, headers: { 'Content-Type': 'application/json' } }
      );

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
      const params: Record<string, any> = {};
      if (includeTranscript !== undefined) params.include_transcript = includeTranscript;

      const response = await axios.get<any>(
        `${COMM_API_URL}/api/v1/batch-calling/${jobId}/results`,
        { params, timeout: 60000, headers: { 'Content-Type': 'application/json' } }
      );

      return response.data;
    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Failed to get batch job results:', jobId, error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'BATCH_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to get batch job results'
      );
    }
  }

  /**
   * Incremental sync: process any call whose transcript has arrived since the last pass.
   *
   * Key design principles (production-ready for 1000+ call batches):
   * - Called on EVERY poll tick (every 30 s), not just when batch is 'completed'
   * - processed_call_ids in BatchCall tracks which phones were already fully handled
   *   → stored in MongoDB so safe across server restarts and horizontal scaling
   * - Automation fires per-call the moment: transcript ready + call ended
   *   → no need to wait for the full batch to complete
   * - conversations_synced=true only when: batch completed + 0 calls still awaiting transcript
   * - Fully idempotent: safe to call multiple times, never double-processes a call
   */
  async syncBatchCallConversations(jobId: string, organizationId: string): Promise<void> {
    const BatchCall = (await import('../models/BatchCall')).default;

    try {
      const batchCall = await BatchCall.findOne({ batch_call_id: jobId }).lean() as any;

      if (!batchCall) {
        console.error('[Batch Calling Service] ❌ Batch call not found in database:', jobId);
        return;
      }
      if (batchCall.status === 'cancelled') {
        console.log('[Batch Calling Service] ⏭️ Skipping sync for cancelled batch:', jobId);
        return;
      }

      // Load already-processed phone numbers into a Set for O(1) lookup
      const alreadyProcessed = new Set<string>(batchCall.processed_call_ids || []);
      const batchIsCompleted = batchCall.status === 'completed';

      // Fetch all results with transcripts from the Python API
      const results = await this.getBatchJobResults(jobId, true);
      if (!results.results || !Array.isArray(results.results)) {
        console.warn('[Batch Calling Service] ⚠️ No results in response for batch:', jobId);
        return;
      }

      const Conversation = (await import('../models/Conversation')).default;
      const Customer = (await import('../models/Customer')).default;
      const Message = (await import('../models/Message')).default;
      const mongoose = (await import('mongoose')).default;
      const { emitToOrganization } = await import('../config/socket');

      const orgObjectId = new mongoose.Types.ObjectId(organizationId);
      const userId = batchCall.userId?.toString() || organizationId;

      // ── helpers ──────────────────────────────────────────────────────────────
      const transcriptReady = (t: any): boolean =>
        t != null && (
          (Array.isArray(t) && t.length > 0) ||
          (typeof t === 'string' && t.trim().length > 0) ||
          (t.messages && Array.isArray(t.messages) && t.messages.length > 0)
        );

      // A call is "connected" (and therefore expected to produce a transcript) when duration > 0
      const callWasConnected = (r: any): boolean =>
        r.duration_seconds != null && Number(r.duration_seconds) > 0;
      // ─────────────────────────────────────────────────────────────────────────

      let conversationsCreated = 0;
      let conversationsSkipped = 0;
      let callsMissingTranscript = 0;
      const newlyProcessed: string[] = []; // phones FULLY done this run (conversation + automation)

      for (const callResult of results.results) {
        try {
          const phoneNumber: string = callResult.phone_number;
          const wasConnected = callWasConnected(callResult);
          const transcript = callResult.transcript;
          const hasTranscript = transcriptReady(transcript);
          const hasEndReason = callResult.end_reason != null && String(callResult.end_reason).trim() !== '';

          // ── SKIP: call not yet dispatched (batch still pending/in_progress) ──────
          // When a batch is pending or in_progress, calls with duration_seconds=0 have
          // NOT failed – they simply haven't been placed yet. NEVER create a conversation
          // for these until the batch is 'completed' (then duration=0 truly means failed/no-answer).
          // This prevents the "Call did not complete successfully" ghost conversations that
          // get created before calls even start, locking phones out of processed_call_ids.
          if (!wasConnected && !batchIsCompleted) {
            console.log(`[Batch Calling Service] ⏳ ${phoneNumber} – call not yet dispatched (batch still ${batchCall.status}), skipping until batch completes`);
            continue;
          }

          // ── SKIP: connected call with no transcript yet ───────────────────────
          // A connected call (duration > 0) WILL have a transcript once the call ends.
          // Leave it for the next 30s tick; do NOT mark as processed.
          if (wasConnected && !hasTranscript) {
            callsMissingTranscript++;
            console.log(`[Batch Calling Service] ⏳ ${phoneNumber} – connected (${callResult.duration_seconds}s) but transcript not ready yet`);
            continue;
          }

          // ── Extract contact info ─────────────────────────────────────────────
          const dynamicVars = callResult.dynamic_variables || {};
          const customerName  = dynamicVars.name || dynamicVars.customer_name || 'Unknown';
          const customerEmail = dynamicVars.email || dynamicVars.customer_email;
          const conversationId = callResult.conversation_id;

          // A call is "ended" when:
          // - end_reason is set (most reliable), OR
          // - call status is completed, OR
          // - transcript exists (a transcript CANNOT exist on an active call)
          // NOTE: for not-connected calls (duration=0) that reach here, batch is already
          // 'completed' so the call truly failed/no-answer – treat it as ended.
          const callEnded = hasEndReason || callResult.status === 'completed' || hasTranscript || (!wasConnected && batchIsCompleted);

          // ── Check for existing conversation BEFORE checking processed_call_ids ──────
          // IMPORTANT: a conversation may have been created prematurely (e.g. before the call
          // started, when duration_seconds was 0) and added to processed_call_ids as "not-connected".
          // In that case, we MUST still update the transcript and trigger automation once it arrives.
          // Only truly skip if already processed AND automation has already fired (i.e. phone is in
          // processed_call_ids AND the conversation has a transcript, meaning we already did the work).
          const existing = await Conversation.findOne({
            organizationId: orgObjectId,
            channel: 'phone',
            'metadata.batch_call_id': jobId,
            'metadata.phone_number': phoneNumber
          });

          if (existing) {
            const existingHasTranscript = transcriptReady((existing as any).transcript);
            // If phone is already processed AND existing conversation already has a transcript,
            // automation was already triggered – truly skip.
            if (alreadyProcessed.has(phoneNumber) && existingHasTranscript) {
              conversationsSkipped++;
              continue;
            }
            conversationsSkipped++;
            // Always patch latest transcript onto the conversation
            if (hasTranscript) {
              await Conversation.updateOne({ _id: existing._id }, { $set: { transcript } });
            }
            // Trigger automation – only when call is fully done + has transcript
            if (callEnded && hasTranscript) {
              try {
                const existingCustomer = await Customer.findById(existing.customerId).lean();
                const { automationService } = await import('./automation.service');
                await automationService.triggerByEvent('batch_call_completed', {
                  event: 'batch_call_completed',
                  batch_id: jobId,
                  conversation_id: existing._id.toString(),
                  contactId: (existingCustomer as any)?._id?.toString() || existing.customerId?.toString(),
                  organizationId,
                  source: 'batch_call',
                  freshContactData: { name: customerName, email: customerEmail, phone: phoneNumber }
                }, { userId, organizationId });
                console.log(`[Batch Calling Service] 🚀 Automation triggered for existing conversation ${existing._id} (${phoneNumber})`);
                // Mark as fully processed ONLY after automation fires
                newlyProcessed.push(phoneNumber);
              } catch (err: any) {
                console.error(`[Batch Calling Service] ⚠️ Automation failed for existing conversation ${existing._id}:`, err.message);
                // Do NOT add to processed_call_ids – retry next poll
              }
            } else {
              // Conversation exists but call not yet fully ended – retry next poll
              console.log(`[Batch Calling Service] ⏳ Existing conversation for ${phoneNumber} – waiting for call to end before triggering automation`);
            }
            continue;
          }

          // ── SKIP: already FULLY processed, no existing conversation to update ──
          // (should rarely happen – just a safety guard)
          if (alreadyProcessed.has(phoneNumber)) {
            conversationsSkipped++;
            continue;
          }

          // ── Find or create Customer ──────────────────────────────────────────
          let customer = await Customer.findOne({ phone: phoneNumber, organizationId: orgObjectId });

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
            let updated = false;
            if (customerName !== 'Unknown' && customer.name !== customerName) {
              customer.name = customerName;
              updated = true;
            }
            if (customerEmail && customer.email !== customerEmail) {
              console.log(`[Batch Calling Service] 📧 Updating email: ${customer.email} → ${customerEmail}`);
              customer.email = customerEmail;
              updated = true;
            }
            if (updated) {
              await customer.save();
              console.log(`[Batch Calling Service] ✅ Updated customer: ${customer.name}`);
            }
          }

          // ── Create Conversation ──────────────────────────────────────────────
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
              callerId: conversationId,
              duration_seconds: callResult.duration_seconds,
              call_successful: callResult.call_successful,
              end_reason: callResult.end_reason,
              recording_url: callResult.recording_url || callResult.audio_url,
              audio_url: callResult.recording_url || callResult.audio_url,
              callInitiated: new Date(
                callResult.duration_seconds
                  ? Date.now() - callResult.duration_seconds * 1000
                  : Date.now()
              ),
              callCompletedAt: new Date(),
              source: 'batch'
            }
          });

          console.log(`[Batch Calling Service] ✅ Conversation ${conversation._id} created for ${customerName} (${phoneNumber})`);

          // Notify frontend so list refreshes in real-time
          try {
            emitToOrganization(organizationId, 'conversation:new', {
              conversationId: conversation._id.toString(),
              channel: 'phone',
              source: 'batch',
              customerId: customer._id.toString(),
              customerName
            });
          } catch (_) { /* non-critical */ }

          // ── Save Messages from transcript ────────────────────────────────────
          if (transcript && Array.isArray(transcript) && transcript.length > 0) {
            const messages: any[] = [];
            for (const entry of transcript) {
              const messageText = entry.message;
              if (!messageText?.trim()) continue;
              const role = entry.role;
              let sender: 'customer' | 'ai' = 'customer';
              if (role === 'agent' || role === 'assistant') sender = 'ai';
              else if (role === 'user' || role === 'customer') sender = 'customer';
              messages.push({
                conversationId: conversation._id,
                sender,
                text: messageText.trim(),
                type: 'message',
                attachments: [],
                sourcesUsed: [],
                topics: [],
                timestamp: new Date(),
                metadata: { transcriptItemId: `${callResult.recipient_id}_${messages.length}`, fromBatchCall: true }
              });
            }
            if (messages.length > 0) {
              await Message.insertMany(messages);
              console.log(`[Batch Calling Service] ✅ Saved ${messages.length} messages for conversation ${conversation._id}`);
            }
          } else {
            // Not connected or no transcript: leave an internal note
            const outcomeText = callResult.call_successful ? 'Call completed successfully.' : 'Call did not complete successfully.';
            await Message.create({
              conversationId: conversation._id,
              type: 'internal_note',
              text: `Batch call to ${customerName} (${phoneNumber}). ${outcomeText}`,
              sender: 'ai',
              timestamp: new Date()
            });
          }

          conversationsCreated++;

          // ── Trigger Automation ───────────────────────────────────────────────
          // Conditions: call ended (end_reason OR status=completed OR transcript present)
          //             AND transcript is non-empty
          // A phone is ONLY marked as processed after automation fires successfully.
          // If not yet ended → conversation is created but phone stays out of processed_call_ids
          // → next 30s poll will re-check, find the existing conversation, and trigger automation.
          if (callEnded && hasTranscript) {
            try {
              const { automationService } = await import('./automation.service');
              await automationService.triggerByEvent('batch_call_completed', {
                event: 'batch_call_completed',
                batch_id: jobId,
                conversation_id: conversation._id.toString(),
                contactId: customer._id.toString(),
                organizationId,
                source: 'batch_call',
                freshContactData: { name: customerName, email: customerEmail, phone: phoneNumber }
              }, { userId, organizationId });
              console.log(`[Batch Calling Service] 🚀 Automation triggered for conversation ${conversation._id} (${phoneNumber})`);
              // Mark as fully processed ONLY after automation fires
              newlyProcessed.push(phoneNumber);
            } catch (err: any) {
              console.error(`[Batch Calling Service] ⚠️ Automation failed for conversation ${conversation._id}:`, err.message);
              // Do NOT add to processed_call_ids – retry next poll
            }
          } else if (!wasConnected) {
            // Not-connected call (busy, no-answer): conversation created, no automation needed → mark done
            newlyProcessed.push(phoneNumber);
          } else {
            // Connected call but not yet ended (transcript/end_reason still pending):
            // Conversation created but NOT added to processed_call_ids.
            // Next poll will find the existing conversation and trigger automation once call ends.
            console.log(`[Batch Calling Service] ⏳ ${phoneNumber} – conversation created, waiting for call to fully end before triggering automation`);
          }

        } catch (resultError: any) {
          console.error(`[Batch Calling Service] ❌ Failed to process call ${callResult.phone_number}:`, resultError.message);
          // Continue with remaining calls; do NOT mark as processed
        }
      }

      // ── Atomically persist newly-processed phone numbers ─────────────────────
      // $addToSet ensures no duplicates even under concurrent runs
      if (newlyProcessed.length > 0) {
        await BatchCall.updateOne(
          { batch_call_id: jobId },
          { $addToSet: { processed_call_ids: { $each: newlyProcessed } } }
        );
      }

      // ── Mark conversations_synced when batch is done and no transcripts pending ──
      if (batchIsCompleted && callsMissingTranscript === 0) {
        await BatchCall.updateOne(
          { batch_call_id: jobId },
          { $set: { conversations_synced: true }, $unset: { syncErrorCount: '' } }
        );
        console.log(`[Batch Calling Service] ✅ Batch ${jobId} fully synced – conversations_synced=true`);
      } else if (callsMissingTranscript > 0) {
        console.log(`[Batch Calling Service] ⏳ Batch ${jobId}: ${callsMissingTranscript} call(s) still awaiting transcript – will retry next poll`);
      }

      console.log(
        `[Batch Calling Service] 📊 Batch ${jobId} sync pass complete:`,
        `${conversationsCreated} created,`,
        `${conversationsSkipped} skipped,`,
        `${newlyProcessed.length} newly processed,`,
        `${callsMissingTranscript} pending transcripts`
      );

      // ── Notify frontend ──────────────────────────────────────────────────────
      if (conversationsCreated > 0 || conversationsSkipped > 0) {
        try {
          emitToOrganization(organizationId, 'batch:conversations-synced', {
            batch_call_id: jobId,
            conversationsCreated,
            conversationsSkipped,
            newlyProcessed: newlyProcessed.length,
            pendingTranscripts: callsMissingTranscript
          });
        } catch (_) { /* non-critical */ }
      }

    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Error in syncBatchCallConversations:', error.message);
      await BatchCall.updateOne(
        { batch_call_id: jobId },
        { $inc: { syncErrorCount: 1 } }
      );
      throw error;
    }
  }
}

export const batchCallingService = new BatchCallingService();
