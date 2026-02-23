import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.util';

/**
 * Handle webhooks from ElevenLabs API
 * POST /api/v1/webhook/elevenlabs
 * 
 * This endpoint receives webhook events from ElevenLabs when various events occur
 * (e.g., post_call_audio, call_started, call_ended, etc.)
 * 
 * Webhooks are logged to console. Only post_call_transcription webhooks are logged to structured logger.
 */
export class ElevenLabsWebhookController {

  /**
   * Handle incoming ElevenLabs webhook events
   * 
   * Always returns 200 OK to prevent retries from ElevenLabs.
   * All webhooks are logged to console. Only post_call_transcription webhooks are logged to structured logger.
   */
  handleWebhook = async (req: Request, res: Response) => {
    try {
      // Acknowledge receipt immediately
      res.status(200).json({ success: true, message: 'Webhook received' });

      // Extract all relevant data
      const body = req.body;
      const method = req.method;
      const url = req.originalUrl;
      const ip = req.ip || req.socket.remoteAddress;
      const timestamp = new Date().toISOString();

      // Log all webhooks to console
      console.log('[ElevenLabs Webhook] 📥 Webhook received');
      console.log('  Type:', body?.type || 'N/A');
      console.log('  Agent ID:', body?.data?.agent_id || 'N/A');
      console.log('  Conversation ID:', body?.data?.conversation_id || 'N/A');
      console.log('  Timestamp:', timestamp);
      console.log('  IP:', ip);
      console.log('  URL:', url);
      
      // Only log post_call_transcription to structured logger
      if (body?.type === 'post_call_transcription') {
        logger.info('[ElevenLabs Webhook] post_call_transcription received', {
          type: body?.type,
          agent_id: body?.data?.agent_id,
          agent_name: body?.data?.agent_name,
          conversation_id: body?.data?.conversation_id,
          user_id: body?.data?.user_id,
          event_timestamp: body?.event_timestamp,
          status: body?.data?.status,
          ip,
          url
        });
      }

      // Process inbound calls
      if (body?.type === 'post_call_transcription' || body?.type === 'post_call_audio') {
        try {
          await this.processInboundCall(body);
        } catch (processError: any) {
          console.error('[ElevenLabs Webhook] ⚠️ Failed to process inbound call:', processError.message);
          logger.error('[ElevenLabs Webhook] Failed to process inbound call', {
            error: processError.message,
            stack: processError.stack,
            type: body?.type,
            agent_id: body?.data?.agent_id,
            conversation_id: body?.data?.conversation_id
          });
        }
      }

      // For outbound (batch) calls – trigger an immediate sync so the transcript is
      // picked up without waiting for the next 30s poll tick.
      if (body?.type === 'post_call_transcription') {
        const direction = body?.data?.metadata?.phone_call?.direction;
        if (direction === 'outbound') {
          try {
            await this.processBatchCallWebhook(body);
          } catch (batchError: any) {
            console.error('[ElevenLabs Webhook] ⚠️ Failed to process outbound batch call webhook:', batchError.message);
          }
        }
      }

    } catch (error: any) {
      // Log error but still return 200 to prevent retries
      console.error('[ElevenLabs Webhook] ❌ ERROR PROCESSING WEBHOOK:', error);
      logger.error('[ElevenLabs Webhook] Error processing webhook', {
        error: error.message,
        stack: error.stack,
        body: req.body,
        headers: req.headers
      });
      
      // Already sent response, so nothing to do here
    }
  };

  /**
   * Process inbound call webhooks
   * Creates conversations for inbound calls similar to outbound calls
   */
  private async processInboundCall(webhookBody: any) {
    const data = webhookBody?.data;
    if (!data) {
      console.log('[ElevenLabs Webhook] No data in webhook body, skipping processing');
      return;
    }

    // Check if this is an inbound call
    const phoneCall = data.metadata?.phone_call;
    const direction = phoneCall?.direction;
    
    if (direction !== 'inbound') {
      console.log('[ElevenLabs Webhook] Call direction is not inbound, skipping:', direction);
      return;
    }

    console.log('[ElevenLabs Webhook] 📞 Processing inbound call webhook');
    console.log('  Agent ID:', data.agent_id);
    console.log('  Conversation ID:', data.conversation_id);
    console.log('  Direction:', direction);

    // Find agent by agent_id
    const Agent = (await import('../models/Agent')).default;
    const agent = await Agent.findOne({ agent_id: data.agent_id });
    
    if (!agent) {
      console.warn('[ElevenLabs Webhook] ⚠️ Agent not found:', data.agent_id);
      return;
    }

    console.log('[ElevenLabs Webhook] ✅ Found agent:', agent.name);

    // Get user and organization
    const User = (await import('../models/User')).default;
    const Organization = (await import('../models/Organization')).default;
    
    const user = await User.findById(agent.userId);
    if (!user) {
      console.warn('[ElevenLabs Webhook] ⚠️ User not found for agent:', agent.userId);
      return;
    }

    // Resolve organizationId
    let organizationId: mongoose.Types.ObjectId;
    if (user.organizationId) {
      const orgId = user.organizationId;
      organizationId = orgId instanceof mongoose.Types.ObjectId 
        ? orgId 
        : new mongoose.Types.ObjectId(String(orgId));
    } else {
      // Try to find organization by ownerId
      const organization = await Organization.findOne({ ownerId: user._id });
      if (organization) {
        organizationId = organization._id;
      } else {
        // Single-tenant: use userId as organizationId
        organizationId = user._id;
      }
    }

    console.log('[ElevenLabs Webhook] ✅ Resolved organizationId:', organizationId.toString());

    // Extract phone number from webhook
    const externalNumber = phoneCall?.external_number || data.user_id;
    if (!externalNumber) {
      console.warn('[ElevenLabs Webhook] ⚠️ No phone number found in webhook');
      return;
    }

    // Find or create customer
    const Customer = (await import('../models/Customer')).default;
    let customer = await Customer.findOne({ 
      phone: externalNumber,
      organizationId: organizationId
    });

    if (!customer) {
      // Create customer with phone number
      customer = await Customer.create({
        name: `Caller ${externalNumber}`,
        phone: externalNumber,
        organizationId: organizationId,
        source: 'phone',
        color: `#${Math.floor(Math.random() * 16777215).toString(16)}`
      });
      console.log('[ElevenLabs Webhook] ✅ Created customer:', customer._id);
    } else {
      console.log('[ElevenLabs Webhook] ✅ Found existing customer:', customer._id);
    }

    // Handle different webhook types
    if (webhookBody.type === 'post_call_transcription') {
      await this.handleTranscriptionWebhook(data, customer._id, organizationId, agent);
    } else if (webhookBody.type === 'post_call_audio') {
      await this.handleAudioWebhook(data, customer._id, organizationId);
    }
  }

  /**
   * Handle post_call_transcription webhook
   * Creates conversation with transcript and messages
   */
  private async handleTranscriptionWebhook(
    data: any,
    customerId: mongoose.Types.ObjectId,
    organizationId: mongoose.Types.ObjectId,
    agent: any
  ) {
    const Conversation = (await import('../models/Conversation')).default;
    const Message = (await import('../models/Message')).default;

    const conversationId = data.conversation_id;
    const transcript = data.transcript || [];
    const metadata = data.metadata || {};
    const phoneCall = metadata.phone_call || {};
    const status = data.status || 'unknown';

    // Check if conversation already exists (might have been created by audio webhook first)
    let conversation = await Conversation.findOne({
      'metadata.conversation_id': conversationId,
      organizationId: organizationId
    });

    if (conversation) {
      console.log('[ElevenLabs Webhook] ✅ Found existing conversation, updating with transcript');
      
      // Update conversation with transcript
      conversation.transcript = transcript;
      conversation.status = status === 'done' ? 'closed' : 'open';
      conversation.metadata = {
        ...conversation.metadata,
        conversation_id: conversationId,
        agent_id: data.agent_id,
        agent_name: data.agent_name,
        call_duration_secs: metadata.call_duration_secs,
        call_sid: phoneCall.call_sid,
        phone_number_id: phoneCall.phone_number_id,
        agent_number: phoneCall.agent_number,
        external_number: phoneCall.external_number,
        direction: phoneCall.direction,
        callInitiated: metadata.start_time_unix_secs 
          ? new Date(metadata.start_time_unix_secs * 1000) 
          : new Date(),
        callCompletedAt: metadata.accepted_time_unix_secs 
          ? new Date((metadata.accepted_time_unix_secs + (metadata.call_duration_secs || 0)) * 1000)
          : new Date(),
        termination_reason: metadata.termination_reason,
        error: metadata.error,
        source: 'inbound_webhook'
      };
      
      await conversation.save();
    } else {
      // Create new conversation
      conversation = await Conversation.create({
        organizationId: organizationId,
        customerId: customerId,
        channel: 'phone',
        status: status === 'done' ? 'closed' : 'open',
        transcript: transcript,
        isAiManaging: true,
        unread: true,
        metadata: {
          conversation_id: conversationId,
          agent_id: data.agent_id,
          agent_name: data.agent_name,
          call_duration_secs: metadata.call_duration_secs,
          call_sid: phoneCall.call_sid,
          phone_number_id: phoneCall.phone_number_id,
          agent_number: phoneCall.agent_number,
          external_number: phoneCall.external_number,
          direction: phoneCall.direction,
          callInitiated: metadata.start_time_unix_secs 
            ? new Date(metadata.start_time_unix_secs * 1000) 
            : new Date(),
          callCompletedAt: metadata.accepted_time_unix_secs 
            ? new Date((metadata.accepted_time_unix_secs + (metadata.call_duration_secs || 0)) * 1000)
            : new Date(),
          termination_reason: metadata.termination_reason,
          error: metadata.error,
          source: 'inbound_webhook'
        }
      });
      
      console.log('[ElevenLabs Webhook] ✅ Created conversation:', conversation._id);
    }

    // Create messages from transcript
    if (Array.isArray(transcript) && transcript.length > 0) {
      // Delete existing messages from this conversation to avoid duplicates
      await Message.deleteMany({
        conversationId: conversation._id,
        'metadata.from_transcript': true
      });

      // Create messages from transcript items
      for (const item of transcript) {
        if (item.message && item.role) {
          await Message.create({
            conversationId: conversation._id,
            sender: item.role === 'user' ? 'customer' : 'ai',
            text: item.message,
            type: 'message',
            timestamp: metadata.start_time_unix_secs && item.time_in_call_secs
              ? new Date((metadata.start_time_unix_secs + item.time_in_call_secs) * 1000)
              : new Date(),
            metadata: {
              from_transcript: true,
              time_in_call_secs: item.time_in_call_secs,
              interrupted: item.interrupted,
              agent_metadata: item.agent_metadata
            }
          });
        }
      }
      
      console.log('[ElevenLabs Webhook] ✅ Created', transcript.length, 'messages from transcript');
    }

    // Add initial note if conversation was just created
    if (!conversation.metadata?.initial_note_added) {
      await Message.create({
        conversationId: conversation._id,
        type: 'internal_note',
        text: `Inbound call received from ${phoneCall.external_number || 'unknown'}`,
        sender: 'ai',
        timestamp: new Date()
      });
      
      conversation.metadata = {
        ...conversation.metadata,
        initial_note_added: true
      };
      await conversation.save();
    }
  }

  /**
   * Handle post_call_audio webhook
   * Updates conversation with audio recording
   */
  private async handleAudioWebhook(
    data: any,
    customerId: mongoose.Types.ObjectId,
    organizationId: mongoose.Types.ObjectId
  ) {
    const Conversation = (await import('../models/Conversation')).default;
    const Message = (await import('../models/Message')).default;

    const conversationId = data.conversation_id;
    const fullAudio = data.full_audio; // Base64 encoded audio

    // Find existing conversation
    let conversation = await Conversation.findOne({
      'metadata.conversation_id': conversationId,
      organizationId: organizationId
    });

    if (conversation) {
      // Update conversation with audio
      conversation.metadata = {
        ...conversation.metadata,
        audio_base64: fullAudio,
        audio_received_at: new Date().toISOString()
      };
      await conversation.save();
      console.log('[ElevenLabs Webhook] ✅ Updated conversation with audio:', conversation._id);
    } else {
      // Create conversation placeholder (transcript will come later)
      conversation = await Conversation.create({
        organizationId: organizationId,
        customerId: customerId,
        channel: 'phone',
        status: 'open',
        isAiManaging: true,
        unread: true,
        metadata: {
          conversation_id: conversationId,
          agent_id: data.agent_id,
          agent_name: data.agent_name,
          audio_base64: fullAudio,
          audio_received_at: new Date().toISOString(),
          direction: 'inbound',
          source: 'inbound_webhook',
          waiting_for_transcript: true,
          external_number: data.user_id // Store phone number from user_id
        }
      });
      
      // Add initial note
      await Message.create({
        conversationId: conversation._id,
        type: 'internal_note',
        text: `Inbound call received from ${data.user_id || 'unknown'}. Audio recording available.`,
        sender: 'ai',
        timestamp: new Date()
      });
      
      console.log('[ElevenLabs Webhook] ✅ Created conversation placeholder with audio:', conversation._id);
    }
  }

  /**
   * When ElevenLabs sends a post_call_transcription webhook for an OUTBOUND (batch) call,
   * trigger an immediate sync so we don't wait for the next 30s poll.
   * The sync function handles everything: fetching batch status, checking per-recipient
   * status, fetching transcripts, creating conversations, and triggering automations.
   * We just need to wait a few seconds for ElevenLabs to update the recipient status
   * to "completed" before we query it.
   */
  private async processBatchCallWebhook(webhookBody: any) {
    const data = webhookBody?.data;
    const phoneNumber: string | undefined = data?.metadata?.phone_call?.external_number || data?.user_id;

    if (!phoneNumber) {
      console.log('[ElevenLabs Webhook] Outbound webhook missing phoneNumber – skipping');
      return;
    }

    console.log(`[ElevenLabs Webhook] 📞 Outbound call completed for ${phoneNumber} – will trigger batch sync in 5s`);

    const BatchCall = (await import('../models/BatchCall')).default;

    // Find the most recent active (not fully synced) batch
    const activeBatch = await BatchCall.findOne({
      conversations_synced: { $ne: true },
      status: { $in: ['pending', 'in_progress', 'completed'] }
    }).sort({ createdAt: -1 }).lean() as any;

    if (!activeBatch) {
      console.log('[ElevenLabs Webhook] No active batch found – skipping');
      return;
    }

    const orgId = activeBatch.organizationId?.toString() || activeBatch.userId?.toString();
    if (!orgId) {
      console.log('[ElevenLabs Webhook] No organizationId on batch – skipping');
      return;
    }

    // Wait 5s for ElevenLabs to update the recipient status to "completed"
    // and make the conversation transcript available via their API.
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      const { batchCallingService } = await import('../services/batchCalling.service');
      console.log(`[ElevenLabs Webhook] 🔄 Triggering sync for batch: ${activeBatch.batch_call_id}`);
      await batchCallingService.syncBatchCallConversations(activeBatch.batch_call_id, orgId);
      console.log(`[ElevenLabs Webhook] ✅ Sync complete for: ${activeBatch.batch_call_id}`);
    } catch (err: any) {
      console.error(`[ElevenLabs Webhook] ⚠️ Sync failed for ${activeBatch.batch_call_id}:`, err.message);
    }
  }
}

export const elevenlabsWebhookController = new ElevenLabsWebhookController();

