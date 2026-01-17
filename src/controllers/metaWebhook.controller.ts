import { Request, Response } from 'express';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Customer from '../models/Customer';
import SocialIntegration from '../models/SocialIntegration';
import { emitToOrganization, emitToConversation } from '../config/socket';
import { pythonRagService } from '../services/pythonRag.service';
import { SocialIntegrationService } from '../services/socialIntegration.service';
import axios from 'axios';

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
   */
  async handleMessenger(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[Messenger Webhook] Received:', JSON.stringify(webhookData, null, 2));

      // Meta Messenger webhook structure
      if (webhookData.entry && webhookData.entry.length > 0) {
        for (const entry of webhookData.entry) {
          if (entry.messaging && entry.messaging.length > 0) {
            for (const messagingEvent of entry.messaging) {
              await this.handleMessengerEvent(messagingEvent, entry.id);
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
   * Handle Messenger event
   */
  private async handleMessengerEvent(messagingEvent: any, pageId: string) {
    try {
      if (!messagingEvent.message) return;

      const message = messagingEvent.message;
      const from = messagingEvent.sender.id;
      const messageId = message.mid;
      const timestamp = new Date(messagingEvent.timestamp);

      // Find integration
      const integration = await SocialIntegration.findOne({
        'credentials.facebookPageId': pageId,
        platform: 'facebook',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[Messenger Webhook] No integration found for page: ${pageId}`);
        return;
      }

      // Find or create customer
      let customer = await Customer.findOne({
        'metadata.facebookId': from,
        organizationId: integration.organizationId
      });

      if (!customer) {
        customer = await Customer.create({
          organizationId: integration.organizationId,
          name: from,
          source: 'facebook',
          metadata: { facebookId: from }
        });
      }

      // Find or create conversation
      let conversation = await Conversation.findOne({
        customerId: customer._id,
        channel: 'social',
        'metadata.platform': 'facebook',
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
            facebookPageId: pageId,
            externalMessageId: messageId
          }
        });
      }

      // Extract message content
      let messageText = '';
      if (message.text) {
        messageText = message.text;
      } else if (message.attachments) {
        messageText = '[Attachment]';
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
          platform: 'facebook'
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
        this.triggerAIReply(conversation, messageText, integration.organizationId.toString(), from, 'messenger').catch(err => {
          console.error('[Messenger Webhook] AI auto-reply error:', err);
        });
      }
    } catch (error) {
      console.error('[Messenger Webhook] Error handling event:', error);
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
    platform: 'whatsapp' | 'messenger' | 'instagram'
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
        const dialog360 = await socialIntegrationService.getDialog360Service(organizationId, 'facebook');
        await dialog360.sendFacebookMessage({
          to: customerId,
          type: 'text',
          text: aiResponse
        });
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

