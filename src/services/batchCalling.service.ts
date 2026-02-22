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
   * Simple incremental sync – called every 30s poll tick AND on ElevenLabs webhook.
   *
   * Logic per call:
   *   1. Already in processed_call_ids? → skip (done)
   *   2. duration > 0 AND transcript has messages? → create conversation, trigger automation, mark done
   *   3. duration = 0 AND batch completed? → create conversation (failed call), NO automation, mark done
   *   4. Everything else → skip, try again next tick
   */
  async syncBatchCallConversations(jobId: string, organizationId: string): Promise<void> {
    const BatchCall = (await import('../models/BatchCall')).default;

    try {
      const batchCall = await BatchCall.findOne({ batch_call_id: jobId }).lean() as any;
      if (!batchCall) {
        console.error('[Batch Calling Service] ❌ Batch not found:', jobId);
        return;
      }
      if (batchCall.status === 'cancelled') {
        console.log('[Batch Calling Service] ⏭️ Skipping cancelled batch:', jobId);
        return;
      }

      const alreadyProcessed = new Set<string>(batchCall.processed_call_ids || []);

      const results = await this.getBatchJobResults(jobId, true);
      if (!results.results || !Array.isArray(results.results)) {
        console.warn('[Batch Calling Service] ⚠️ No results for batch:', jobId);
        return;
      }

      // Use live status from Python API so we're never blocked by stale DB
      const liveStatus = (results.batch_status || results.status || batchCall.status || '').toLowerCase();
      
      if (liveStatus && liveStatus !== batchCall.status) {
        await BatchCall.updateOne({ batch_call_id: jobId }, { $set: { status: liveStatus } });
        console.log(`[Batch Calling Service] 🔄 Status refreshed: ${batchCall.status} → ${liveStatus}`);
      }

      const Conversation = (await import('../models/Conversation')).default;
      const Customer = (await import('../models/Customer')).default;
      const Message = (await import('../models/Message')).default;
      const mongoose = (await import('mongoose')).default;
      const { emitToOrganization } = await import('../config/socket');

      const orgObjectId = new mongoose.Types.ObjectId(organizationId);
      
      // Check if all conversations have transcripts - batch is truly done only when transcripts are received
      const allConversations = await Conversation.find({
        organizationId: orgObjectId,
        channel: 'phone',
        'metadata.batch_call_id': jobId
      }).lean() as any[];
      
      const conversationsWithTranscripts = allConversations.filter(conv => hasTranscript(conv.transcript)).length;
      const totalConversations = allConversations.length;
      const allTranscriptsReceived = totalConversations > 0 && conversationsWithTranscripts === totalConversations;
      
      // Batch is done if: Python API says completed AND all transcripts received (or no conversations created yet)
      const batchDone = liveStatus === 'completed' && (allTranscriptsReceived || totalConversations === 0);
      
      if (liveStatus === 'completed' && !allTranscriptsReceived && totalConversations > 0) {
        console.log(`[Batch Calling Service] ⏳ Batch marked completed by API but waiting for transcripts (${conversationsWithTranscripts}/${totalConversations} received) - will keep polling`);
      }
      const userId = batchCall.userId?.toString() || organizationId;

      const hasTranscript = (t: any): boolean =>
        t != null && (
          (Array.isArray(t) && t.length > 0) ||
          (typeof t === 'string' && t.trim().length > 0) ||
          (t.messages && Array.isArray(t.messages) && t.messages.length > 0)
        );

      let created = 0;
      let skipped = 0;
      let waiting = 0;
      const newlyProcessed: string[] = [];

      for (const call of results.results) {
        try {
          const phone: string = call.phone_number;
          const duration = Number(call.duration_seconds || 0);
          const transcript = call.transcript;
          const ready = hasTranscript(transcript);
          // A call is "connected" if duration > 0 OR it has a real transcript.
          // The Python API sometimes returns duration_seconds=0 for calls that
          // actually happened — the transcript is the definitive proof.
          const connected = duration > 0 || ready;

          // 1. Already done? skip.
          if (alreadyProcessed.has(phone)) { skipped++; continue; }

          // 2. Connected (duration > 0) but transcript not ready yet? wait for next tick.
          if (duration > 0 && !ready) {
            waiting++;
            console.log(`[Batch Calling Service] ⏳ ${phone} – ${duration}s call, transcript not ready yet`);
            continue;
          }

          // 3. Not connected and batch not done yet? call hasn't been placed, skip.
          if (!connected && !batchDone) { continue; }

          // ── At this point we WILL process this call ──────────────────────────
          // Either: (a) connected + transcript ready, or (b) not connected + batch done
          const vars = call.dynamic_variables || {};
          const name = vars.name || vars.customer_name || 'Unknown';
          const email = vars.email || vars.customer_email;

          // Check if conversation already exists (e.g. from a previous deploy/crash)
          const existing = await Conversation.findOne({
            organizationId: orgObjectId,
            channel: 'phone',
            'metadata.batch_call_id': jobId,
            'metadata.phone_number': phone
          });

          if (existing) {
            // Conversation exists – just make sure transcript is updated
            if (ready) {
              await Conversation.updateOne({ _id: existing._id }, { $set: { transcript } });
            }
            // Mark as processed - automation will be triggered when batch completes
            newlyProcessed.push(phone);
            skipped++;
            continue;
          }

          // ── Find or create customer ────────────────────────────────────────
          let customer = await Customer.findOne({ phone, organizationId: orgObjectId });
          if (!customer) {
            customer = await Customer.create({
              name, phone, email,
              organizationId: orgObjectId,
              source: 'phone',
              color: `#${Math.floor(Math.random() * 16777215).toString(16)}`
            });
          } else {
            let updated = false;
            if (name !== 'Unknown' && customer.name !== name) { customer.name = name; updated = true; }
            if (email && customer.email !== email) { customer.email = email; updated = true; }
            if (updated) await customer.save();
          }

          // ── Create conversation ────────────────────────────────────────────
          const conversation = await Conversation.create({
            organizationId: orgObjectId,
            customerId: customer._id,
            channel: 'phone',
            status: (call.call_successful === true || call.status === 'completed' || (connected && ready && call.call_successful !== false)) ? 'closed' : 'open',
            transcript: transcript || undefined,
            isAiManaging: true,
            unread: false,
            metadata: {
              batch_call_id: jobId,
              conversation_id: call.conversation_id,
              recipient_id: call.recipient_id,
              phone_number: phone,
              callerId: call.conversation_id,
              duration_seconds: duration,
              call_successful: call.call_successful,
              end_reason: call.end_reason,
              recording_url: call.recording_url || call.audio_url,
              audio_url: call.recording_url || call.audio_url,
              callInitiated: new Date(duration ? Date.now() - duration * 1000 : Date.now()),
              callCompletedAt: new Date(),
              source: 'batch'
            }
          });

          console.log(`[Batch Calling Service] ✅ Conversation ${conversation._id} created for ${name} (${phone})`);
          try { emitToOrganization(organizationId, 'conversation:new', { conversationId: conversation._id.toString(), channel: 'phone', source: 'batch', customerId: customer._id.toString(), customerName: name }); } catch (_) {}

          // ── Save messages ──────────────────────────────────────────────────
          if (ready && Array.isArray(transcript)) {
            const msgs: any[] = [];
            for (const entry of transcript) {
              if (!entry.message?.trim()) continue;
              msgs.push({
                conversationId: conversation._id,
                sender: (entry.role === 'agent' || entry.role === 'assistant') ? 'ai' : 'customer',
                text: entry.message.trim(),
                type: 'message',
                attachments: [], sourcesUsed: [], topics: [],
                timestamp: new Date(),
                metadata: { transcriptItemId: `${call.recipient_id}_${msgs.length}`, fromBatchCall: true }
              });
            }
            if (msgs.length > 0) {
              await Message.insertMany(msgs);
              console.log(`[Batch Calling Service] ✅ Saved ${msgs.length} messages for ${conversation._id}`);
            }
          } else {
            const isSuccessful = call.call_successful === true || call.status === 'completed' || (connected && ready && call.call_successful !== false);
            const note = isSuccessful ? 'Call completed successfully.' : 'Call did not complete successfully.';
            await Message.create({ conversationId: conversation._id, type: 'internal_note', text: `Batch call to ${name} (${phone}). ${note}`, sender: 'ai', timestamp: new Date() });
          }

          created++;

          // Mark as processed - automation will be triggered when batch completes
          newlyProcessed.push(phone);

        } catch (err: any) {
          console.error(`[Batch Calling Service] ❌ Failed to process ${call.phone_number}:`, err.message);
        }
      }

      // Persist processed phones atomically
      if (newlyProcessed.length > 0) {
        await BatchCall.updateOne(
          { batch_call_id: jobId },
          { $addToSet: { processed_call_ids: { $each: newlyProcessed } } }
        );
      }

      // ── Trigger automations for successful calls when batch is completed ──
      // Trigger for ANY call with transcript, don't wait for all calls
      if (batchDone) {
        console.log(`[Batch Calling Service] 🚀 Batch completed - checking conversations for successful calls with transcripts`);
        
        // Find ALL conversations for this batch (source of truth, not API results)
        const allConversations = await Conversation.find({
          organizationId: orgObjectId,
          channel: 'phone',
          'metadata.batch_call_id': jobId
        }).lean() as any[];

        console.log(`[Batch Calling Service] 📋 Found ${allConversations.length} conversation(s) for batch ${jobId}`);

        // Get list of conversation IDs that have already had automations triggered
        const batchCallUpdated = await BatchCall.findOne({ batch_call_id: jobId }).lean() as any;
        const processedConversationIds = new Set<string>(
          (batchCallUpdated?.automation_triggered_conversation_ids || []).map((id: any) => id.toString())
        );

        const successfulCalls: Array<{
          conversationId: string;
          contactId: string;
          phone: string;
          name: string;
          email?: string;
        }> = [];

        let triggeredCount = 0;
        let skippedCount = 0;

        // Check each conversation directly (more reliable than API results)
        for (const conversation of allConversations) {
          const conversationId = conversation._id.toString();
          const phone = conversation.metadata?.phone_number;
          
          if (!phone) {
            console.log(`[Batch Calling Service] ⚠️ Conversation ${conversationId} missing phone number`);
            continue;
          }

          // Skip if automation already triggered for this conversation
          if (processedConversationIds.has(conversationId)) {
            skippedCount++;
            console.log(`[Batch Calling Service] ⏭️ Automation already triggered for ${phone} (conversation ${conversationId})`);
            continue;
          }

          // Refresh conversation from DB to get latest transcript (webhook might have just saved it)
          const freshConversation = await Conversation.findById(conversationId).lean() as any;
          if (!freshConversation) {
            console.log(`[Batch Calling Service] ⚠️ Conversation ${conversationId} not found in DB`);
            continue;
          }

          const convDuration = freshConversation.metadata?.call_duration_secs || freshConversation.metadata?.duration_seconds || 0;
          const convTerminationReason = freshConversation.metadata?.termination_reason || freshConversation.metadata?.end_reason;
          const convHasTranscript = hasTranscript(freshConversation.transcript);
          
          console.log(`[Batch Calling Service] 🔍 Checking conversation ${phone}: duration=${convDuration}s, hasTranscript=${convHasTranscript}, termination=${convTerminationReason ? 'yes' : 'no'}`);

          // Only process conversations that have transcripts
          if (!convHasTranscript) {
            console.log(`[Batch Calling Service] ⏳ Conversation ${phone} waiting for transcript - will check on next sync`);
            continue;
          }

          // A call is successful if it has transcript AND (duration > 0 OR termination_reason)
          const definitelySuccessful = convHasTranscript && (convDuration > 0 || convTerminationReason);
          
          if (definitelySuccessful) {
            // Get customer info
            const customer = await Customer.findById(freshConversation.customerId).lean() as any;
            const name = customer?.name || freshConversation.metadata?.name || 'Unknown';
            const email = customer?.email || freshConversation.metadata?.email;

            console.log(`[Batch Calling Service] ✅ Call ${phone} confirmed successful (duration: ${convDuration}s, termination: ${convTerminationReason ? 'yes' : 'no'})`);
            
            successfulCalls.push({
              conversationId,
              contactId: freshConversation.customerId?.toString() || '',
              phone,
              name,
              email
            });
          } else {
            console.log(`[Batch Calling Service] ⏭️ Call ${phone} not successful (duration: ${convDuration}s, termination: ${convTerminationReason ? 'yes' : 'no'})`);
            // Mark as processed even if not successful to avoid re-checking
            processedConversationIds.add(conversationId);
          }
        }

        // Trigger automations for all successful calls (even if only 1 has transcript)
        if (successfulCalls.length > 0) {
          console.log(`[Batch Calling Service] 📋 Found ${successfulCalls.length} successful call(s) with transcripts - triggering automations`);
          
          const { automationService } = await import('./automation.service');
          const newlyTriggeredIds: string[] = [];
          
          // Trigger automation for each successful call
          for (const callData of successfulCalls) {
            try {
              await automationService.triggerByEvent('batch_call_completed', {
                event: 'batch_call_completed',
                batch_id: jobId,
                conversation_id: callData.conversationId,
                contactId: callData.contactId,
                organizationId,
                source: 'batch_call',
                freshContactData: { name: callData.name, email: callData.email, phone: callData.phone }
              }, { userId, organizationId });
              console.log(`[Batch Calling Service] 🚀 Automation triggered for ${callData.phone} (${callData.name})`);
              newlyTriggeredIds.push(callData.conversationId);
              triggeredCount++;
            } catch (err: any) {
              console.error(`[Batch Calling Service] ⚠️ Automation failed for ${callData.phone}:`, err.message);
              // Continue with other calls even if one fails
            }
          }

          // Mark which conversations have had automations triggered (to avoid duplicates)
          if (newlyTriggeredIds.length > 0) {
            await BatchCall.updateOne(
              { batch_call_id: jobId },
              { $addToSet: { automation_triggered_conversation_ids: { $each: newlyTriggeredIds } } }
            );
            console.log(`[Batch Calling Service] ✅ Automations triggered for ${triggeredCount} call(s), ${skippedCount} already processed`);
          }
        } else {
          console.log(`[Batch Calling Service] ⏭️ No successful calls with transcripts found in this sync`);
        }

        // Mark batch fully done ONLY when all conversations have transcripts
        // This ensures we keep polling until transcripts arrive
        if (allTranscriptsReceived || totalConversations === 0) {
          await BatchCall.updateOne(
            { batch_call_id: jobId },
            { $set: { conversations_synced: true }, $unset: { syncErrorCount: '' } }
          );
          console.log(`[Batch Calling Service] ✅ Batch ${jobId} fully synced (all ${totalConversations} conversation(s) have transcripts)`);
        } else {
          console.log(`[Batch Calling Service] ⏳ Batch ${jobId} not fully synced yet - waiting for ${totalConversations - conversationsWithTranscripts} more transcript(s)`);
        }
      } else if (liveStatus === 'completed' && !allTranscriptsReceived && totalConversations > 0) {
        // Batch is completed by API but transcripts not all received - keep polling
        console.log(`[Batch Calling Service] ⏳ Batch ${jobId} completed by API but transcripts pending (${conversationsWithTranscripts}/${totalConversations}) - will keep checking`);
      }

      console.log(`[Batch Calling Service] 📊 Batch ${jobId}: ${created} created, ${skipped} skipped, ${newlyProcessed.length} processed, ${waiting} waiting`);

      if (created > 0 || newlyProcessed.length > 0) {
        try { emitToOrganization(organizationId, 'batch:conversations-synced', { batch_call_id: jobId, conversationsCreated: created, newlyProcessed: newlyProcessed.length, pendingTranscripts: waiting }); } catch (_) {}
      }

    } catch (error: any) {
      console.error('[Batch Calling Service] ❌ Sync error:', error.message);
      await BatchCall.updateOne({ batch_call_id: jobId }, { $inc: { syncErrorCount: 1 } });
      throw error;
    }
  }
}

export const batchCallingService = new BatchCallingService();
