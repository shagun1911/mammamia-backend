import { Request, Response } from 'express';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Customer from '../models/Customer';
import SocialIntegration from '../models/SocialIntegration';
import { emitToOrganization, emitToConversation } from '../config/socket';
import axios from 'axios';

export class InstagramWebhookController {
  private readonly VERIFY_TOKEN = 'instagram_verify_M9Qe7KX2R4LpA8';

  /**
   * Verify Instagram webhook (GET request)
   * Meta sends a GET request with hub.verify_token and hub.challenge
   */
  async verify(req: Request, res: Response) {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === this.VERIFY_TOKEN) {
        console.log('[Instagram Webhook] Verification successful');
        res.status(200).send(challenge);
      } else {
        console.log('[Instagram Webhook] Verification failed', { mode, token, expected: this.VERIFY_TOKEN });
        res.sendStatus(403);
      }
    } catch (error) {
      console.error('[Instagram Webhook] Verification error:', error);
      res.sendStatus(500);
    }
  }

  /**
   * Handle incoming Instagram webhook events (POST request)
   */
  async handleIncoming(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[Instagram Webhook] Received:', JSON.stringify(webhookData, null, 2));

      // Instagram webhook structure
      if (webhookData.entry && webhookData.entry.length > 0) {
        for (const entry of webhookData.entry) {
          // Handle messaging events
          if (entry.messaging && entry.messaging.length > 0) {
            for (const messagingEvent of entry.messaging) {
              await this.handleMessagingEvent(messagingEvent, entry.id);
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
   * Handle Instagram messaging events
   */
  private async handleMessagingEvent(messagingEvent: any, pageId: string) {
    try {
      const senderId = messagingEvent.sender?.id;
      const recipientId = messagingEvent.recipient?.id;
      const timestamp = messagingEvent.timestamp ? new Date(messagingEvent.timestamp * 1000) : new Date();

      // Find integration by Instagram account ID (recipient is the Instagram Business Account)
      const integration = await SocialIntegration.findOne({
        'credentials.instagramAccountId': recipientId,
        platform: 'instagram',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[Instagram Webhook] No Instagram integration found for account: ${recipientId}`);
        return;
      }

      // Normalize event based on type
      if (messagingEvent.message) {
        await this.handleMessage(messagingEvent.message, senderId, recipientId, timestamp, integration, pageId);
      } else if (messagingEvent.postback) {
        await this.handlePostback(messagingEvent.postback, senderId, recipientId, timestamp, integration, pageId);
      } else if (messagingEvent.reaction) {
        await this.handleReaction(messagingEvent.reaction, senderId, recipientId, timestamp, integration, pageId);
      } else if (messagingEvent.read) {
        await this.handleReadReceipt(messagingEvent.read, senderId, recipientId, timestamp, integration, pageId);
      }
    } catch (error) {
      console.error('[Instagram Webhook] Error handling messaging event:', error);
    }
  }

  /**
   * Handle Instagram message
   */
  private async handleMessage(
    message: any,
    senderId: string,
    recipientId: string,
    timestamp: Date,
    integration: any,
    pageId: string
  ) {
    try {
      const messageId = message.mid;
      const messageType = message.text ? 'text' : this.getMessageType(message);

      // Normalize message
      const normalizedMessage = {
        platform: 'instagram',
        userId: senderId,
        messageId: messageId,
        messageType: messageType,
        text: message.text || undefined,
        timestamp: timestamp.getTime(),
        rawPayload: message
      };

      console.log('[Instagram Webhook] Normalized message:', normalizedMessage);

      // Find or create customer
      let customer = await Customer.findOne({
        'metadata.instagramId': senderId,
        organizationId: integration.organizationId
      });

      if (!customer) {
        // Try to fetch sender name from Meta Graph API
        let senderName = senderId;
        try {
          const pageAccessToken = integration.credentials?.pageAccessToken;
          if (pageAccessToken) {
            const response = await axios.get(
              `https://graph.facebook.com/v18.0/${senderId}?fields=username,name&access_token=${pageAccessToken}`
            );
            if (response.data?.name) {
              senderName = response.data.name;
            } else if (response.data?.username) {
              senderName = response.data.username;
            }
            console.log('[Instagram] Fetched sender name:', senderName);
          }
        } catch (error: any) {
          console.warn('[Instagram] Could not fetch sender name, using ID:', error.message);
        }
        
        customer = await Customer.create({
          organizationId: integration.organizationId,
          name: senderName,
          source: 'instagram',
          metadata: { instagramId: senderId }
        });
      } else if (!customer.name || customer.name === customer.metadata?.instagramId) {
        // Update customer name if it's still an ID
        try {
          const pageAccessToken = integration.credentials?.pageAccessToken;
          if (pageAccessToken) {
            const response = await axios.get(
              `https://graph.facebook.com/v18.0/${senderId}?fields=username,name&access_token=${pageAccessToken}`
            );
            if (response.data?.name) {
              customer.name = response.data.name;
              await customer.save();
            } else if (response.data?.username) {
              customer.name = response.data.username;
              await customer.save();
            }
          }
        } catch (error: any) {
          console.warn('[Instagram] Could not update sender name:', error.message);
        }
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

      // Extract message content
      let messageText = '';
      if (message.text) {
        messageText = message.text;
      } else if (message.attachments) {
        messageText = '[Attachment]';
      } else {
        messageText = `[${messageType}]`;
      }

      // Save message to database
      const dbMessage = await Message.create({
        conversationId: conversation._id,
        organizationId: integration.organizationId,
        customerId: customer._id,
        sender: 'customer',
        text: messageText,
        type: 'message',
        timestamp,
        metadata: {
          externalId: messageId,
          platform: 'instagram',
          messageType: messageType,
          normalizedMessage: normalizedMessage
        }
      });

      // Update conversation
      conversation.unread = true;
      conversation.updatedAt = new Date();
      await conversation.save();

      console.log(`[Instagram Webhook] Message saved for conversation ${conversation._id}`);

      // Emit socket event
      emitToOrganization(integration.organizationId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: messageText,
          sender: 'customer',
          timestamp
        }
      });

      emitToConversation(conversation._id.toString(), 'message-received', {
        text: messageText,
        sender: 'customer',
        timestamp
      });

      // Pass normalized message to KepleroAI processor (trigger AI reply if enabled)
      if (conversation.isAiManaging) {
        console.log('[Instagram Webhook] Triggering AI auto-reply for Instagram...');
        this.triggerAIReply(conversation, messageText, integration.organizationId.toString(), senderId, recipientId).catch(err => {
          console.error('[Instagram Webhook] AI auto-reply error:', err);
        });
      }
    } catch (error) {
      console.error('[Instagram Webhook] Error handling message:', error);
    }
  }

  /**
   * Handle Instagram postback
   */
  private async handlePostback(
    postback: any,
    senderId: string,
    recipientId: string,
    timestamp: Date,
    integration: any,
    pageId: string
  ) {
    try {
      const normalizedEvent = {
        platform: 'instagram',
        userId: senderId,
        messageId: postback.mid || `postback_${Date.now()}`,
        messageType: 'postback',
        text: postback.title || postback.payload,
        timestamp: timestamp.getTime(),
        rawPayload: postback
      };

      console.log('[Instagram Webhook] Postback received:', normalizedEvent);

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

      // Save postback as message
      await Message.create({
        conversationId: conversation._id,
        organizationId: integration.organizationId,
        customerId: customer._id,
        sender: 'customer',
        text: `[Postback: ${postback.title || postback.payload}]`,
        type: 'message',
        timestamp,
        metadata: {
          platform: 'instagram',
          messageType: 'postback',
          postbackPayload: postback.payload,
          normalizedEvent: normalizedEvent
        }
      });
    } catch (error) {
      console.error('[Instagram Webhook] Error handling postback:', error);
    }
  }

  /**
   * Handle Instagram reaction
   */
  private async handleReaction(
    reaction: any,
    senderId: string,
    recipientId: string,
    timestamp: Date,
    integration: any,
    pageId: string
  ) {
    try {
      const normalizedEvent = {
        platform: 'instagram',
        userId: senderId,
        messageId: reaction.mid || `reaction_${Date.now()}`,
        messageType: 'reaction',
        text: reaction.reaction || reaction.emoji,
        timestamp: timestamp.getTime(),
        rawPayload: reaction
      };

      console.log('[Instagram Webhook] Reaction received:', normalizedEvent);

      // Reactions are typically not saved as messages, just logged
      // But we can track them if needed
    } catch (error) {
      console.error('[Instagram Webhook] Error handling reaction:', error);
    }
  }

  /**
   * Handle Instagram read receipt
   */
  private async handleReadReceipt(
    read: any,
    senderId: string,
    recipientId: string,
    timestamp: Date,
    integration: any,
    pageId: string
  ) {
    try {
      const watermark = read.watermark;

      // Update messages as read
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

      console.log(`[Instagram Webhook] Read receipts updated for watermark: ${watermark}`);
    } catch (error) {
      console.error('[Instagram Webhook] Error handling read receipt:', error);
    }
  }

  /**
   * Get message type from Instagram message
   */
  private getMessageType(message: any): string {
    if (message.text) return 'text';
    if (message.attachments) {
      const attachment = message.attachments[0];
      return attachment.type || 'attachment';
    }
    return 'unknown';
  }

  /**
   * Trigger AI auto-reply for Instagram
   */
  private async triggerAIReply(
    conversation: any,
    userMessage: string,
    organizationId: string,
    instagramUserId: string,
    instagramAccountId: string
  ) {
    try {
      // Import services
      const { pythonRagService } = await import('../services/pythonRag.service');
      const Organization = (await import('../models/Organization')).default;
      const Settings = (await import('../models/Settings')).default;
      const User = (await import('../models/User')).default;

      // Find organization
      const organization = await Organization.findById(organizationId);
      if (!organization) {
        console.log(`[Instagram AI] Organization not found: ${organizationId}`);
        return;
      }

      // Get settings with fallback logic
      let settings = await Settings.findOne({ userId: organization.ownerId });
      if (!settings) {
        const users = await User.find({ organizationId: organizationId }).limit(5);
        for (const user of users) {
          settings = await Settings.findOne({ userId: user._id });
          if (settings && (settings.defaultKnowledgeBaseNames?.length > 0 || settings.defaultKnowledgeBaseName)) break;
        }
      }

      // Get knowledge base names (prioritize array, fallback to string)
      let collectionNames: string[] = [];
      if (settings?.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
        collectionNames = settings.defaultKnowledgeBaseNames;
      } else if (settings?.defaultKnowledgeBaseName) {
        collectionNames = [settings.defaultKnowledgeBaseName];
      }

      if (collectionNames.length === 0) {
        console.log('[Instagram AI] No knowledge base configured');
        return;
      }

      // Get system prompt from AIBehavior
      const { aiBehaviorService } = await import('../services/aiBehavior.service');
      let systemPrompt = 'You are a helpful AI assistant. Provide accurate and concise responses based on the knowledge base.';
      try {
        const userId = organization.ownerId?.toString() || (await User.findOne({ organizationId: organizationId }))?._id?.toString();
        if (userId) {
          const aiBehavior = await aiBehaviorService.get(userId);
          if (aiBehavior?.chatAgent?.systemPrompt) {
            systemPrompt = aiBehavior.chatAgent.systemPrompt;
            console.log('[Instagram AI] Using custom system prompt from AIBehavior');
          }
        }
      } catch (error: any) {
        console.warn('[Instagram AI] Could not fetch system prompt from AIBehavior, using default:', error.message);
      }

      // Get recent conversation history
      const recentMessages = await Message.find({ conversationId: conversation._id })
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();

      // Call Python RAG service
      const ragResponse = await pythonRagService.chat({
        query: userMessage,
        collectionNames: collectionNames,
        topK: 5,
        threadId: conversation._id.toString(),
        systemPrompt: systemPrompt
      });

      const aiResponse = ragResponse.answer;
      if (!aiResponse) {
        console.error('[Instagram AI] No response from RAG service');
        return;
      }

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

      // Send AI response via Instagram (using Messenger Send API with page access token)
      await this.sendInstagramMessage(instagramAccountId, instagramUserId, aiResponse, organizationId);

      console.log('[Instagram AI] Response sent successfully');

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
      console.error('[Instagram AI] Failed:', error.message || error);
    }
  }

  /**
   * Send Instagram message using Messenger Send API (Graph API)
   * Instagram uses the same API as Messenger, just with Instagram account ID
   */
  private async sendInstagramMessage(
    instagramAccountId: string,
    recipientId: string,
    messageText: string,
    organizationId: string
  ) {
    try {
      // Find integration to get page access token
      const integration = await SocialIntegration.findOne({
        'credentials.instagramAccountId': instagramAccountId,
        platform: 'instagram',
        organizationId: organizationId,
        status: 'connected'
      });

      if (!integration) {
        throw new Error('Instagram integration not found');
      }

      // Get decrypted page access token (Instagram uses the connected Facebook Page's access token)
      // The apiKey field stores the encrypted access token, or pageAccessToken might be in credentials
      let pageAccessToken = (integration.credentials as any).pageAccessToken;
      
      if (!pageAccessToken) {
        // Fallback to decrypted apiKey (which is the access token)
        pageAccessToken = (integration as any).getDecryptedApiKey();
      }
      
      if (!pageAccessToken) {
        throw new Error('Page access token not found');
      }

      // Use Graph API to send message to Instagram
      // Instagram messaging uses the same endpoint as Messenger but with Instagram account ID
      const graphApiUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}/messages`;

      const response = await axios.post(
        graphApiUrl,
        {
          recipient: { id: recipientId },
          message: { text: messageText }
        },
        {
          headers: {
            'Authorization': `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('[Instagram Send] Message sent successfully:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('[Instagram Send] Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

export default new InstagramWebhookController();

