import { Request, Response } from 'express';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Customer from '../models/Customer';
import SocialIntegration from '../models/SocialIntegration';
import { emitToOrganization, emitToConversation } from '../config/socket';
import { pythonRagService } from '../services/pythonRag.service';
import { SocialIntegrationService } from '../services/socialIntegration.service';
import axios from 'axios';
import mongoose from 'mongoose';

const socialIntegrationService = new SocialIntegrationService();

export class MetaWebhookController {
  /**
   * Verify webhook (GET request) - Generic handler for all Meta platforms
   */
  async verify(req: Request, res: Response, platform: 'whatsapp' | 'messenger' | 'instagram') {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      // Get platform-specific verify token from environment
      let verifyToken: string;
      switch (platform) {
        case 'whatsapp':
          verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'whatsapp_verify_token';
          break;
        case 'messenger':
          verifyToken = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN || 'messenger_verify_token';
          break;
        case 'instagram':
          verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'instagram_verify_M9Qe7KX2R4LpA8';
          break;
        default:
          verifyToken = '';
      }

      if (mode === 'subscribe' && token === verifyToken) {
        console.log(`[${platform.toUpperCase()} Webhook] Verification successful`);
        res.status(200).send(challenge);
      } else {
        console.log(`[${platform.toUpperCase()} Webhook] Verification failed`, { 
          mode, 
          token, 
          expected: verifyToken,
          platform 
        });
        res.sendStatus(403);
      }
    } catch (error) {
      console.error(`[${platform.toUpperCase()} Webhook] Verification error:`, error);
      res.sendStatus(500);
    }
  }

  /**
   * Handle incoming WhatsApp webhook events (POST request)
   */
  async handleWhatsApp(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[WhatsApp Webhook] Received:', JSON.stringify(webhookData, null, 2));

      // Meta WhatsApp webhook structure
      if (webhookData.entry && webhookData.entry.length > 0) {
        for (const entry of webhookData.entry) {
          if (entry.changes && entry.changes.length > 0) {
            for (const change of entry.changes) {
              if (change.field === 'messages' && change.value) {
                await this.handleWhatsAppMessage(change.value);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[WhatsApp Webhook] Error processing webhook:', error);
      // Don't throw - we already sent 200 response
    }
  }

  /**
   * Handle incoming Messenger webhook events (POST request)
   * Matches Python reference implementation exactly
   */
  async handleMessenger(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately (like Python script)
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[Messenger Webhook] Received webhook:', JSON.stringify(webhookData, null, 2));

      // Process incoming messages - EXACT MATCH with Python script
      // Python: if request.get('object') == 'page':
      if (webhookData.object === 'page') {
        // Python: for entry in request.get('entry', []):
        for (const entry of webhookData.entry || []) {
          // Python: page_id = entry.get('id')
          const pageId = entry.id;
          
          // Python: for event in entry.get('messaging', []):
          for (const event of entry.messaging || []) {
            // Python: sender_id = event.get('sender', {}).get('id')
            const senderId = event.sender?.id;
            
            // Python: if 'message' in event:
            if (event.message) {
              // Python: message_text = event['message'].get('text', '')
              const messageText = event.message.text || '';
              
              // Python: print(f"Received message from {sender_id}: {message_text}")
              console.log(`[Messenger Webhook] Received message from ${senderId}: ${messageText}`);
              console.log(`[Messenger Webhook] Page ID: ${pageId}`);
              console.log(`[Messenger Webhook] Sender PSID: ${senderId}`);
              
              // Immediately process and reply (synchronous, like Python script)
              await this.processMessengerMessage(pageId, senderId, messageText, event);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Messenger Webhook] Error processing webhook:', error);
      // Don't throw - we already sent 200 response
    }
  }

  /**
   * Handle incoming Instagram webhook events (POST request)
   */
  async handleInstagram(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[Instagram Webhook] Received:', JSON.stringify(webhookData, null, 2));

      // Meta Instagram webhook structure (same as Messenger)
      if (webhookData.entry && webhookData.entry.length > 0) {
        for (const entry of webhookData.entry) {
          if (entry.messaging && entry.messaging.length > 0) {
            for (const messagingEvent of entry.messaging) {
              await this.handleInstagramEvent(messagingEvent, entry.id);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Instagram Webhook] Error processing webhook:', error);
      // Don't throw - we already sent 200 response
    }
  }

  /**
   * Handle WhatsApp message
   */
  private async handleWhatsAppMessage(data: any) {
    try {
      const message = data.messages?.[0];
      if (!message) return;

      const from = message.from; // Customer phone number
      const messageId = message.id;
      const timestamp = new Date(parseInt(message.timestamp) * 1000);
      const phoneNumberId = data.metadata?.phone_number_id;

      // Find integration
      const integration = await SocialIntegration.findOne({
        'credentials.phoneNumberId': phoneNumberId,
        platform: 'whatsapp',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[WhatsApp Webhook] No integration found for phone number ID: ${phoneNumberId}`);
        return;
      }

      // Find or create customer
      let customer = await Customer.findOne({
        phoneNumber: from,
        organizationId: integration.organizationId
      });

      if (!customer) {
        customer = await Customer.create({
          organizationId: integration.organizationId,
          phoneNumber: from,
          name: from,
          source: 'whatsapp'
        });
      }

      // Find or create conversation
      let conversation = await Conversation.findOne({
        customerId: customer._id,
        channel: 'whatsapp',
        status: { $in: ['open', 'unread'] }
      });

      if (!conversation) {
        conversation = await Conversation.create({
          organizationId: integration.organizationId,
          customerId: customer._id,
          channel: 'whatsapp',
          status: 'unread',
          isAiManaging: true,
          metadata: {
            phoneNumberId,
            externalMessageId: messageId
          }
        });
      }

      // Extract message content
      let messageText = '';
      if (message.type === 'text') {
        messageText = message.text?.body || '';
      } else {
        messageText = `[${message.type}]`;
      }

      // Save message
      await Message.create({
        conversationId: conversation._id,
        organizationId: integration.organizationId,
        customerId: customer._id,
        sender: 'customer',
        text: messageText,
        type: 'message',
        timestamp,
        metadata: {
          externalId: messageId,
          platform: 'whatsapp',
          phoneNumberId
        }
      });

      // Update conversation
      conversation.unread = true;
      conversation.updatedAt = new Date();
      await conversation.save();

      // Emit socket event
      emitToOrganization(integration.organizationId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: messageText,
          sender: 'customer',
          timestamp
        }
      });

      // Trigger AI reply if enabled
      if (conversation.isAiManaging) {
        this.triggerAIReply(conversation, messageText, integration.organizationId.toString(), from, 'whatsapp').catch(err => {
          console.error('[WhatsApp Webhook] AI auto-reply error:', err);
        });
      }
    } catch (error) {
      console.error('[WhatsApp Webhook] Error handling message:', error);
    }
  }

  /**
   * Process Messenger message and send chatbot reply immediately
   * Matches Python reference implementation - synchronous, immediate reply
   */
  private async processMessengerMessage(
    pageId: string,
    senderPsid: string,
    messageText: string,
    event: any
  ) {
    try {
      // Skip echo messages (messages sent by the Page itself)
      if (event.message?.is_echo) {
        console.log('[Messenger Webhook] Skipping echo message (sent by Page)');
        return;
      }

      // Skip if no text message
      if (!messageText || messageText.trim() === '') {
        console.log('[Messenger Webhook] Skipping empty message');
        return;
      }

      // Find integration using page_id (matching OAuth storage structure)
      // OAuth stores: credentials.facebookPageId and credentials.pageAccessToken
      // Webhook only provides page_id, so we use it as the primary key
      const integration = await SocialIntegration.findOne({
        'credentials.facebookPageId': pageId,
        platform: 'facebook',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[Messenger Webhook] No integration found for page_id: ${pageId}`);
        console.warn(`[Messenger Webhook] Searched for: credentials.facebookPageId === ${pageId}`);
        return;
      }

      // Check if chatbot is enabled
      const chatbotEnabled = integration.metadata?.chatbotEnabled === true;
      if (!chatbotEnabled) {
        console.log('[Messenger Webhook] Chatbot not enabled for this integration');
        return;
      }

      // Get Page Access Token directly from credentials (matching OAuth storage exactly)
      // OAuth stores token in: credentials.pageAccessToken
      const pageAccessToken = integration.credentials.pageAccessToken;

      if (!pageAccessToken) {
        console.error(`[Messenger Webhook] ❌ No Page Access Token found for page_id: ${pageId}`);
        console.error(`[Messenger Webhook] Integration credentials:`, {
          hasFacebookPageId: !!integration.credentials.facebookPageId,
          hasPageAccessToken: !!integration.credentials.pageAccessToken,
          facebookPageId: integration.credentials.facebookPageId
        });
        return;
      }

      console.log(`[Messenger Webhook] ✅ Found Page Access Token for page_id: ${pageId}`);

      console.log(`[Messenger Webhook] Processing message - Page: ${pageId}, PSID: ${senderPsid}, Text: ${messageText}`);

      // Generate chatbot reply immediately (synchronous, like Python script)
      // NOTE: Messenger chatbot uses KnowledgeBase directly via appUserId from OAuth state
      // Python reference: Only needs Page → Integration → appUserId → KnowledgeBase → RAG
      const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
      const mongoose = (await import('mongoose')).default;

      // Get internal app userId from integration metadata (stored during OAuth)
      const appUserId = integration.metadata?.appUserId;

      if (!appUserId) {
        console.error('[Messenger Webhook] No appUserId found in integration metadata');
        console.error('[Messenger Webhook] Integration metadata:', {
          hasMetadata: !!integration.metadata,
          metadataKeys: integration.metadata ? Object.keys(integration.metadata) : []
        });
        return;
      }

      // Validate appUserId is a valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(appUserId)) {
        console.error('[Messenger Webhook] Invalid appUserId format:', appUserId);
        return;
      }

      // Find KnowledgeBase directly by userId (stored during OAuth)
      const kb = await KnowledgeBase.findOne({
        userId: new mongoose.Types.ObjectId(appUserId)
      }).sort({ createdAt: -1 });

      if (!kb) {
        console.warn('[Messenger Webhook] No KnowledgeBase found for user:', appUserId);
        return;
      }

      const collectionName = kb.collectionName;
      
      console.log('[Messenger Webhook] Using KnowledgeBase:', {
        kbId: kb._id.toString(),
        collectionName
      });

      // Call RAG service to get reply
      const ragResponse = await pythonRagService.chat({
        query: messageText,
        collectionNames: [collectionName],
        topK: 5,
        threadId: `messenger_${pageId}_${senderPsid}`, // Simple thread ID
        systemPrompt: 'You are a helpful AI assistant. Provide accurate and concise responses based on the knowledge base.'
      });

      const botReply = ragResponse.answer;
      if (!botReply || botReply.trim() === '') {
        console.warn('[Messenger Webhook] No reply generated from RAG service');
        return;
      }

      console.log(`[Messenger Webhook] Got reply from RAG: ${botReply.substring(0, 100)}...`);
      console.log(`[Messenger Webhook] Sending reply to PSID: ${senderPsid}`);

      // Send reply immediately using Messenger Send API (EXACT MATCH with Python script)
      // Python: POST https://graph.facebook.com/v18.0/{PAGE_ID}/messages
      const { MetaOAuthService } = await import('../services/metaOAuth.service');
      const metaAppId = process.env.META_APP_ID || '';
      const metaAppSecret = process.env.META_APP_SECRET || '';
      const backendUrl = process.env.BACKEND_URL || '';
      
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId,
        appSecret: metaAppSecret,
        redirectUri: `${backendUrl}/api/v1/social-integrations/facebook/oauth/callback`
      });

      // Send message (matching Python script exactly)
      const messageId = await metaOAuth.sendMessengerMessage(
        pageId,
        pageAccessToken,
        senderPsid, // PSID
        botReply
      );

      console.log(`[Messenger Webhook] ✅ Reply sent successfully. Message ID: ${messageId || 'N/A'}`);

      // Optional: Save to database (for conversation history)
      // This is additional functionality beyond Python script, but useful for our system
      try {
        // Find or create customer
        let customer = await Customer.findOne({
          'metadata.facebookId': senderPsid,
          organizationId: integration.organizationId
        });

        if (!customer) {
          customer = await Customer.create({
            organizationId: integration.organizationId,
            name: senderPsid,
            source: 'facebook',
            metadata: { facebookId: senderPsid }
          });
        }

        // Find or create conversation
        let conversation = await Conversation.findOne({
          customerId: customer._id,
          channel: 'social',
          'metadata.platform': 'facebook',
          'metadata.facebookPageId': pageId,
          status: { $in: ['open', 'unread'] }
        });

        if (!conversation) {
          conversation = await Conversation.create({
            organizationId: integration.organizationId,
            customerId: customer._id,
            channel: 'social',
            status: 'unread',
            isAiManaging: true,
            metadata: {
              platform: 'facebook',
              facebookPageId: pageId
            }
          });
        }

        // Save user message
        await Message.create({
          conversationId: conversation._id,
          organizationId: integration.organizationId,
          customerId: customer._id,
          sender: 'customer',
          text: messageText,
          type: 'message',
          timestamp: new Date(),
          metadata: {
            externalId: event.message?.mid,
            platform: 'facebook'
          }
        });

        // Save bot reply
        await Message.create({
          conversationId: conversation._id,
          organizationId: integration.organizationId,
          customerId: customer._id,
          sender: 'ai',
          text: botReply,
          type: 'message',
          timestamp: new Date(),
          metadata: {
            externalId: messageId,
            platform: 'facebook',
            generatedBy: 'rag-service'
          }
        });

        // Update conversation
        conversation.updatedAt = new Date();
        await conversation.save();

        // Emit socket event
        emitToOrganization(integration.organizationId.toString(), 'new-message', {
          conversationId: conversation._id?.toString() || '',
          message: {
            text: botReply,
            sender: 'ai',
            timestamp: new Date()
          }
        });
      } catch (dbError) {
        // Don't fail if database save fails - message was already sent
        console.error('[Messenger Webhook] Error saving to database (message was sent):', dbError);
      }
    } catch (error: any) {
      console.error('[Messenger Webhook] Error processing message:', error.message || error);
    }
  }

  /**
   * Handle Instagram event
   */
  private async handleInstagramEvent(messagingEvent: any, pageId: string) {
    try {
      const senderId = messagingEvent.sender?.id;
      const recipientId = messagingEvent.recipient?.id;
      const timestamp = messagingEvent.timestamp ? new Date(messagingEvent.timestamp * 1000) : new Date();

      // Find integration
      const integration = await SocialIntegration.findOne({
        'credentials.instagramAccountId': recipientId,
        platform: 'instagram',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[Instagram Webhook] No integration found for account: ${recipientId}`);
        return;
      }

      // Handle different event types
      if (messagingEvent.message) {
        await this.handleInstagramMessage(messagingEvent.message, senderId, recipientId, timestamp, integration, pageId);
      } else if (messagingEvent.postback) {
        // Handle postback
        console.log('[Instagram Webhook] Postback received:', messagingEvent.postback);
      } else if (messagingEvent.reaction) {
        // Handle reaction
        console.log('[Instagram Webhook] Reaction received:', messagingEvent.reaction);
      } else if (messagingEvent.read) {
        // Handle read receipt
        await this.handleInstagramRead(messagingEvent.read, recipientId);
      }
    } catch (error) {
      console.error('[Instagram Webhook] Error handling event:', error);
    }
  }

  /**
   * Handle Instagram message
   */
  private async handleInstagramMessage(
    message: any,
    senderId: string,
    recipientId: string,
    timestamp: Date,
    integration: any,
    pageId: string
  ) {
    try {
      const messageId = message.mid;
      const messageText = message.text || '[Attachment]';

      // Find or create customer
      let customer = await Customer.findOne({
        'metadata.instagramId': senderId,
        organizationId: integration.organizationId
      });

      if (!customer) {
        customer = await Customer.create({
          organizationId: integration.organizationId,
          name: senderId,
          source: 'instagram',
          metadata: { instagramId: senderId }
        });
      }

      // Find or create conversation
      let conversation = await Conversation.findOne({
        customerId: customer._id,
        channel: 'social',
        'metadata.platform': 'instagram',
        status: { $in: ['open', 'unread'] }
      });

      if (!conversation) {
        conversation = await Conversation.create({
          organizationId: integration.organizationId,
          customerId: customer._id,
          channel: 'social',
          status: 'unread',
          isAiManaging: true,
          metadata: {
            platform: 'instagram',
            instagramAccountId: recipientId,
            pageId: pageId
          }
        });
      }

      // Save message
      await Message.create({
        conversationId: conversation._id,
        organizationId: integration.organizationId,
        customerId: customer._id,
        sender: 'customer',
        text: messageText,
        type: 'message',
        timestamp,
        metadata: {
          externalId: messageId,
          platform: 'instagram'
        }
      });

      // Update conversation
      conversation.unread = true;
      conversation.updatedAt = new Date();
      await conversation.save();

      // Emit socket event
      emitToOrganization(integration.organizationId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: messageText,
          sender: 'customer',
          timestamp
        }
      });

      // Trigger AI reply if enabled
      if (conversation.isAiManaging) {
        this.triggerAIReply(conversation, messageText, integration.organizationId.toString(), senderId, 'instagram').catch(err => {
          console.error('[Instagram Webhook] AI auto-reply error:', err);
        });
      }
    } catch (error) {
      console.error('[Instagram Webhook] Error handling message:', error);
    }
  }

  /**
   * Handle Instagram read receipt
   */
  private async handleInstagramRead(read: any, recipientId: string) {
    try {
      const watermark = read.watermark;

      await Message.updateMany(
        {
          'metadata.platform': 'instagram',
          'metadata.instagramAccountId': recipientId,
          timestamp: { $lte: new Date(watermark * 1000) }
        },
        {
          $set: {
            'metadata.read': true,
            'metadata.readAt': new Date(watermark * 1000)
          }
        }
      );
    } catch (error) {
      console.error('[Instagram Webhook] Error handling read receipt:', error);
    }
  }

  /**
   * Trigger AI auto-reply
   */
  private async triggerAIReply(
    conversation: any,
    userMessage: string,
    organizationId: string,
    customerId: string,
    platform: 'whatsapp' | 'messenger' | 'instagram',
    pageId?: string,
    integration?: any
  ) {
    try {
      const Organization = (await import('../models/Organization')).default;
      const Settings = (await import('../models/Settings')).default;
      const User = (await import('../models/User')).default;

      const organization = await Organization.findById(organizationId);
      if (!organization) return;

      let settings = await Settings.findOne({ userId: organization.ownerId });
      if (!settings) {
        const users = await User.find({ organizationId: organizationId }).limit(5);
        for (const user of users) {
          settings = await Settings.findOne({ userId: user._id });
          if (settings?.defaultKnowledgeBaseName) break;
        }
      }

      if (!settings || !settings.defaultKnowledgeBaseName) return;

      const collectionName = settings.defaultKnowledgeBaseName;

      const ragResponse = await pythonRagService.chat({
        query: userMessage,
        collectionNames: [collectionName],
        topK: 5,
        threadId: conversation._id.toString(),
        systemPrompt: 'You are a helpful AI assistant. Provide accurate and concise responses based on the knowledge base.'
      });

      const aiResponse = ragResponse.answer;
      if (!aiResponse) return;

      // Save AI message
      await Message.create({
        conversationId: conversation._id,
        sender: 'ai',
        text: aiResponse,
        type: 'message',
        timestamp: new Date(),
        metadata: {
          generatedBy: 'rag-service',
          collectionNames: [collectionName]
        }
      });

      // Send response via appropriate channel
      if (platform === 'whatsapp') {
        const dialog360 = await socialIntegrationService.getDialog360Service(organizationId, 'whatsapp');
        await dialog360.sendWhatsAppMessage({
          to: customerId,
          type: 'text',
          text: aiResponse
        });
      } else if (platform === 'messenger') {
        // Use Graph API directly with Page Access Token for Messenger
        if (!integration || !pageId) {
          console.error('[Messenger AI] Missing integration or pageId for Messenger reply');
          return;
        }

        // Get Page Access Token from integration
        // Check multiple possible storage locations
        // Get Page Access Token directly from credentials (matching OAuth storage)
        const pageAccessToken = integration.credentials?.pageAccessToken;
        
        if (!pageAccessToken) {
          console.error('[Messenger AI] No Page Access Token found in integration for page:', pageId);
          console.error('[Messenger AI] Integration credentials:', {
            hasFacebookPageId: !!integration.credentials?.facebookPageId,
            hasPageAccessToken: !!integration.credentials?.pageAccessToken,
            facebookPageId: integration.credentials?.facebookPageId
          });
          return;
        }

        // Import MetaOAuthService to use sendMessengerMessage
        const { MetaOAuthService } = await import('../services/metaOAuth.service');
        const metaAppId = process.env.META_APP_ID || '';
        const metaAppSecret = process.env.META_APP_SECRET || '';
        const backendUrl = process.env.BACKEND_URL || '';
        
        const metaOAuth = new MetaOAuthService({
          appId: metaAppId,
          appSecret: metaAppSecret,
          redirectUri: `${backendUrl}/api/v1/social-integrations/facebook/oauth/callback`
        });

        // Send message via Messenger Graph API
        const messageId = await metaOAuth.sendMessengerMessage(
          pageId,
          pageAccessToken,
          customerId, // PSID
          aiResponse
        );

        console.log(`[Messenger AI] ✅ Reply sent successfully. Message ID: ${messageId}`);
      } else if (platform === 'instagram') {
        // Use Graph API for Instagram
        const integration = await SocialIntegration.findOne({
          organizationId: organizationId,
          platform: 'instagram',
          status: 'connected'
        });
        if (integration) {
          const pageAccessToken = (integration as any).getDecryptedApiKey();
          const instagramAccountId = integration.credentials.instagramAccountId;
          
          await axios.post(
            `https://graph.facebook.com/v18.0/${instagramAccountId}/messages`,
            {
              recipient: { id: customerId },
              message: { text: aiResponse }
            },
            {
              headers: {
                'Authorization': `Bearer ${pageAccessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
        }
      }

      // Emit socket event
      emitToOrganization(organizationId, 'new-message', {
        conversationId: conversation._id.toString(),
        message: {
          text: aiResponse,
          sender: 'ai',
          timestamp: new Date()
        }
      });
    } catch (error: any) {
      console.error(`[${platform} AI] Failed:`, error.message || error);
    }
  }
}

export default new MetaWebhookController();

