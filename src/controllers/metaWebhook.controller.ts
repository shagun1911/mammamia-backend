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

/**
 * Organization context resolved from integration
 */
interface OrgContext {
  organization?: any; // Organization document (optional)
  users: any[]; // User documents
  settings?: any; // Settings document (optional)
  collectionName?: string; // Knowledge base collection name
}

export class MetaWebhookController {
  /**
   * Resolve organization context from integration with robust fallbacks
   * Handles cases where Organization may not exist
   */
  private async resolveOrgContextFromIntegration(integration: any): Promise<OrgContext | null> {
    const Organization = (await import('../models/Organization')).default;
    const User = (await import('../models/User')).default;
    const Settings = (await import('../models/Settings')).default;
    const mongoose = (await import('mongoose')).default;

    // Step 1: Resolve organizationId safely (keep raw value for user queries)
    let orgIdRaw = integration.organizationId || integration.metadata?.organizationId;
    
    // Try alternative sources if not found
    if (!orgIdRaw) {
      const userId = integration.metadata?.userId;
      if (userId) {
        console.log('[Instagram Webhook] Looking up User by userId to find organizationId');
        const user = await User.findById(userId);
        if (user?.organizationId) {
          orgIdRaw = user.organizationId;
          console.log('[Instagram Webhook] Found organizationId from User:', orgIdRaw);
        } else if (user?._id) {
          // If user has no organizationId, use user._id as fallback
          orgIdRaw = user._id;
          console.log('[Instagram Webhook] Using user._id as organizationId fallback:', orgIdRaw);
        }
      }
    }

    if (!orgIdRaw) {
      console.error('[Instagram Webhook] ❌ No organizationId found in integration');
      return null;
    }

    console.log(`[Instagram Webhook] Resolved organizationId (raw): ${orgIdRaw} (type: ${typeof orgIdRaw})`);

    // Convert to ObjectId for lookups (if valid)
    const orgObjectId = mongoose.Types.ObjectId.isValid(orgIdRaw)
      ? new mongoose.Types.ObjectId(orgIdRaw)
      : null;

    // Step 1: Try Organization (if exists)
    let organization = null;
    if (orgObjectId) {
      try {
        organization = await Organization.findById(orgObjectId);
        if (organization) {
          console.log(`[Instagram Webhook] ✅ Organization found: ${orgObjectId}`);
        } else {
          console.log(`[Instagram Webhook] ⚠️  Organization not found: ${orgObjectId} (will try user fallbacks)`);
        }
      } catch (error: any) {
        console.warn(`[Instagram Webhook] ⚠️  Error looking up Organization: ${error.message} (will try user fallbacks)`);
      }
    } else {
      console.log(`[Instagram Webhook] ⚠️  organizationId is not a valid ObjectId, skipping Organization lookup (will try user fallbacks)`);
    }

    // Step 2: Try users by organizationId field (query BOTH string and ObjectId forms)
    let users: any[] = [];
    
    if (orgIdRaw) {
      const userQuery: any = {
        $or: [
          { organizationId: orgIdRaw } // string match (original value)
        ]
      };

      // Add ObjectId match if valid
      if (orgObjectId) {
        userQuery.$or.push({ organizationId: orgObjectId });
      }

      users = await User.find(userQuery).limit(10);
      
      // Log which path matched
      if (users.length > 0) {
        const matchedAsString = users.some(u => String(u.organizationId) === String(orgIdRaw));
        const matchedAsObjectId = orgObjectId && users.some(u => u.organizationId?.equals?.(orgObjectId));
        
        console.log(`[Instagram Webhook] Found ${users.length} user(s) by organizationId field:`, {
          raw: orgIdRaw,
          objectId: orgObjectId?.toString(),
          matchedAsString,
          matchedAsObjectId: matchedAsObjectId || false
        });
      } else {
        console.log(`[Instagram Webhook] No users found by organizationId field (will try final fallback)`);
      }
    }

    // Step 3: FINAL FALLBACK — organizationId IS userId (single-tenant case)
    if (users.length === 0 && orgObjectId) {
      console.log(`[Instagram Webhook] Attempting final fallback: treating organizationId as userId...`);
      const ownerUser = await User.findById(orgObjectId);
      if (ownerUser) {
        users = [ownerUser];
        console.warn(`[Instagram Webhook] ⚠️  organizationId resolved as userId (single-tenant mode)`);
        console.log(`[Instagram Webhook] Owner user resolved: ${ownerUser._id}`);
      } else {
        console.log(`[Instagram Webhook] No user found with _id === organizationId`);
      }
    }

    // HARD FAIL only after ALL fallbacks
    if (users.length === 0) {
      console.error('[Instagram Webhook] ❌ Failed to resolve user context from integration after all fallbacks:', {
        orgIdRaw,
        orgObjectId: orgObjectId?.toString(),
        hasOrganization: !!organization
      });
      return null;
    }

    console.log(`[Instagram Webhook] ✅ Resolved ${users.length} user(s) for context`);

    // Step 4: Resolve Settings safely
    // Use users[0] as owner (single-tenant: organizationId === userId)
    let settings = null;
    
    // Try organization owner first (if organization exists)
    if (organization?.ownerId) {
      settings = await Settings.findOne({ userId: organization.ownerId });
      if (settings) {
        console.log(`[Instagram Webhook] ✅ Settings found for organization owner: ${organization.ownerId}`);
      }
    }

    // Fallback: Use users[0] as owner (single-tenant case)
    if (!settings && users.length > 0) {
      const ownerUser = users[0];
      console.log(`[Instagram Webhook] Using first user as owner: ${ownerUser._id}`);
      settings = await Settings.findOne({ userId: ownerUser._id });
      if (settings) {
        console.log(`[Instagram Webhook] ✅ Settings found for owner user: ${ownerUser._id}`);
      }
    }

    // Final fallback: iterate all users and find first Settings with KB configured
    if (!settings) {
      console.log('[Instagram Webhook] Searching for settings in all users...');
      for (const user of users) {
        const userSettings = await Settings.findOne({ userId: user._id });
        if (userSettings) {
          // Check if settings has KB configured (either format)
          const hasKB = 
            (userSettings.defaultKnowledgeBaseNames && userSettings.defaultKnowledgeBaseNames.length > 0) ||
            userSettings.defaultKnowledgeBaseName;
          
          if (hasKB) {
            settings = userSettings;
            console.log(`[Instagram Webhook] ✅ Settings found for user: ${user._id} (with KB configured)`);
            break;
          }
        }
      }
    }

    if (!settings) {
      console.error('[Instagram Webhook] ❌ No settings found with KB configured');
      return {
        organization: organization || undefined,
        users,
        settings: undefined
      };
    }

    // Step 5: Validate KB configuration (support both formats)
    let collectionName: string | undefined = undefined;

    // Priority 1: defaultKnowledgeBaseNames (array)
    if (settings.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
      collectionName = settings.defaultKnowledgeBaseNames[0];
      console.log(`[Instagram Webhook] ✅ Knowledge base resolved: ${collectionName}`);
    }
    // Priority 2: defaultKnowledgeBaseName (string - legacy)
    else if (settings.defaultKnowledgeBaseName) {
      collectionName = settings.defaultKnowledgeBaseName;
      console.log(`[Instagram Webhook] ✅ Knowledge base resolved: ${collectionName}`);
    }

    if (!collectionName) {
      console.error('[Instagram Webhook] ❌ No KB configured in settings');
      return {
        organization: organization || undefined,
        users,
        settings
      };
    }

    return {
      organization: organization || undefined,
      users,
      settings,
      collectionName
    };
  }
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
   * Matches Messenger webhook pattern exactly
   */
  async handleInstagram(req: Request, res: Response) {
    try {
      // Acknowledge receipt immediately (like Messenger)
      res.sendStatus(200);

      const webhookData = req.body;
      console.log('[Instagram Webhook] Received webhook:', JSON.stringify(webhookData, null, 2));

      // Process incoming messages - EXACT MATCH with Messenger pattern
      // Check for object = "instagram"
      if (webhookData.object === 'instagram') {
        // Process entries
        for (const entry of webhookData.entry || []) {
          // Instagram account ID (recipient)
          const instagramAccountId = entry.id;
          
          // Process messaging events
          for (const event of entry.messaging || []) {
            // Extract sender ID
            const senderId = event.sender?.id;
            
            // Only process message events (ignore delivery, read receipts, reactions, echoes)
            if (event.message) {
              const messageText = event.message.text || '';
              
              console.log(`[Instagram Webhook] Received message from ${senderId}: ${messageText}`);
              console.log(`[Instagram Webhook] Instagram Account ID: ${instagramAccountId}`);
              console.log(`[Instagram Webhook] Sender ID: ${senderId}`);
              
              // Immediately process and reply (synchronous, like Messenger)
              await this.processInstagramMessage(instagramAccountId, senderId, messageText, event);
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
          // Try to fetch sender name from Meta Graph API
          let senderName = senderPsid;
          try {
            const pageAccessToken = integration.credentials?.pageAccessToken;
            if (pageAccessToken) {
              const response = await axios.get(
                `https://graph.facebook.com/v18.0/${senderPsid}?fields=first_name,last_name,name&access_token=${pageAccessToken}`
              );
              if (response.data?.name) {
                senderName = response.data.name;
              } else if (response.data?.first_name) {
                senderName = response.data.first_name + (response.data.last_name ? ` ${response.data.last_name}` : '');
              }
              console.log('[Messenger] Fetched sender name:', senderName);
            }
          } catch (error: any) {
            console.warn('[Messenger] Could not fetch sender name, using PSID:', error.message);
          }
          
          customer = await Customer.create({
            organizationId: integration.organizationId,
            name: senderName,
            source: 'facebook',
            metadata: { facebookId: senderPsid }
          });
        } else if (!customer.name || customer.name === customer.metadata?.facebookId) {
          // Update customer name if it's still an ID
          try {
            const pageAccessToken = integration.credentials?.pageAccessToken;
            if (pageAccessToken) {
              const response = await axios.get(
                `https://graph.facebook.com/v18.0/${senderPsid}?fields=first_name,last_name,name&access_token=${pageAccessToken}`
              );
              if (response.data?.name) {
                customer.name = response.data.name;
                await customer.save();
              } else if (response.data?.first_name) {
                customer.name = response.data.first_name + (response.data.last_name ? ` ${response.data.last_name}` : '');
                await customer.save();
              }
            }
          } catch (error: any) {
            console.warn('[Messenger] Could not update sender name:', error.message);
          }
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
   * Process Instagram message and send chatbot reply immediately
   * Matches Messenger pattern - synchronous, immediate reply
   */
  private async processInstagramMessage(
    instagramAccountId: string,
    senderId: string,
    messageText: string,
    event: any
  ) {
    try {
      console.log('[Instagram Webhook] Event received');
      console.log('[Instagram Webhook] Processing message - Account:', instagramAccountId, 'Sender:', senderId, 'Text:', messageText);

      // Skip echo messages (messages sent by the Instagram account itself)
      if (event.message?.is_echo) {
        console.log('[Instagram Webhook] Skipping echo message (sent by Instagram account)');
        return;
      }

      // Skip if senderId == instagramAccountId (echo)
      if (senderId === instagramAccountId) {
        console.log('[Instagram Webhook] Skipping echo message (senderId === instagramAccountId)');
        return;
      }

      // Skip if no text message
      if (!messageText || messageText.trim() === '') {
        console.log('[Instagram Webhook] Skipping empty message');
        return;
      }

      // Find integration using instagramAccountId (matching OAuth storage structure)
      const integration = await SocialIntegration.findOne({
        'credentials.instagramAccountId': instagramAccountId,
        platform: 'instagram',
        status: 'connected'
      });

      if (!integration) {
        console.warn(`[Instagram Webhook] No integration found for instagramAccountId: ${instagramAccountId}`);
        console.warn(`[Instagram Webhook] Searched for: credentials.instagramAccountId === ${instagramAccountId}`);
        return;
      }

      console.log(`[Instagram] Integration found for instagramAccountId: ${instagramAccountId}`);

      // Resolve organization context with robust fallbacks
      const orgContext = await this.resolveOrgContextFromIntegration(integration);
      
      if (!orgContext) {
        console.error('[Instagram Webhook] ❌ Failed to resolve organization context');
        return;
      }

      if (!orgContext.collectionName) {
        console.error('[Instagram Webhook] ❌ No knowledge base collection name resolved');
        return;
      }

      const collectionName = orgContext.collectionName;
      const organizationId = integration.organizationId || 
                           integration.metadata?.organizationId || 
                           (orgContext.users[0]?.organizationId?.toString());
      
      console.log(`[Instagram] Organization resolved: ${organizationId || 'via users fallback'}`);
      console.log(`[Instagram] KB selected: ${collectionName}`);

      // Generate AI reply using RAG service
      console.log(`[Instagram Webhook] Generating AI reply for message: ${messageText.substring(0, 100)}...`);
      
      const ragResponse = await pythonRagService.chat({
        query: messageText,
        collectionNames: [collectionName],
        topK: 5,
        threadId: `instagram_${instagramAccountId}_${senderId}`, // Simple thread ID
        systemPrompt: 'You are a helpful AI assistant. Provide accurate and concise responses based on the knowledge base.'
      });

      const botReply = ragResponse.answer;
      if (!botReply || botReply.trim() === '') {
        console.warn('[Instagram Webhook] No reply generated from RAG service');
        // Use fallback text
        const fallbackText = 'Thank you for your message. I am processing your request.';
        console.log(`[Instagram Webhook] Using fallback text: ${fallbackText}`);
        await this.sendInstagramReply(instagramAccountId, senderId, fallbackText, integration);
        return;
      }

      console.log(`[Instagram Webhook] Got reply from RAG: ${botReply.substring(0, 100)}...`);
      console.log(`[Instagram Webhook] Sending reply...`);

      // Send reply immediately using Instagram Messaging API
      await this.sendInstagramReply(instagramAccountId, senderId, botReply, integration);

      console.log(`[Instagram Webhook] ✅ Reply sent successfully`);

      // Optional: Save to database (for conversation history)
      try {
        // Use organizationId from context (may be from users fallback)
        const finalOrganizationId = organizationId || orgContext.users[0]?.organizationId;
        
        if (!finalOrganizationId) {
          console.warn('[Instagram Webhook] Cannot save to database - no organizationId available');
          return; // Don't fail, just skip database save
        }

        // Find or create customer
        let customer = await Customer.findOne({
          'metadata.instagramId': senderId,
          organizationId: finalOrganizationId
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
            organizationId: finalOrganizationId,
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
          'metadata.instagramAccountId': instagramAccountId,
          status: { $in: ['open', 'unread'] }
        });

        if (!conversation) {
          conversation = await Conversation.create({
            organizationId: finalOrganizationId,
            customerId: customer._id,
            channel: 'social',
            status: 'unread',
            isAiManaging: true,
            metadata: {
              platform: 'instagram',
              instagramAccountId: instagramAccountId
            }
          });
        }

        // Save user message
        await Message.create({
          conversationId: conversation._id,
          organizationId: finalOrganizationId,
          customerId: customer._id,
          sender: 'customer',
          text: messageText,
          type: 'message',
          timestamp: new Date(),
          metadata: {
            externalId: event.message?.mid,
            platform: 'instagram'
          }
        });

        // Save bot reply
        await Message.create({
          conversationId: conversation._id,
          organizationId: finalOrganizationId,
          customerId: customer._id,
          sender: 'ai',
          text: botReply,
          type: 'message',
          timestamp: new Date(),
          metadata: {
            platform: 'instagram',
            generatedBy: 'rag-service',
            collectionNames: [collectionName]
          }
        });

        // Update conversation
        conversation.updatedAt = new Date();
        await conversation.save();

        // Emit socket event
        emitToOrganization(finalOrganizationId.toString(), 'new-message', {
          conversationId: conversation._id?.toString() || '',
          message: {
            text: botReply,
            sender: 'ai',
            timestamp: new Date()
          }
        });
      } catch (dbError) {
        // Don't fail if database save fails - message was already sent
        console.error('[Instagram Webhook] Error saving to database (message was sent):', dbError);
      }
    } catch (error: any) {
      console.error('[Instagram Webhook] Error processing message:', error.message || error);
      console.error('[Instagram Webhook] Error stack:', error.stack);
    }
  }

  /**
   * Send Instagram DM reply via Graph API
   * POST https://graph.facebook.com/v18.0/me/messages
   * 
   * IMPORTANT: Instagram Messaging API uses Page Access Token (EAAG) from Facebook OAuth
   * This is the same token used for Messenger, obtained via /me/accounts
   */
  private async sendInstagramReply(
    instagramAccountId: string,
    senderId: string,
    messageText: string,
    integration: any
  ): Promise<void> {
    try {
      // Get Page Access Token from integration credentials
      // Instagram DM replies use Page Access Token (EAAG) from Facebook OAuth
      const pageAccessToken = integration.credentials?.pageAccessToken;

      if (!pageAccessToken) {
        console.error(`[Instagram Webhook] ❌ No Page Access Token found for instagramAccountId: ${instagramAccountId}`);
        console.error(`[Instagram Webhook] Integration credentials:`, {
          hasInstagramAccountId: !!integration.credentials?.instagramAccountId,
          hasPageAccessToken: !!integration.credentials?.pageAccessToken,
          instagramAccountId: integration.credentials?.instagramAccountId
        });
        throw new Error('Page Access Token not found. Please re-authenticate Instagram OAuth.');
      }

      // HARD SAFETY CHECK: Only accept Page tokens (EAAG) for Instagram messaging
      const tokenPrefix = pageAccessToken.substring(0, 4);
      console.log(`[Instagram Webhook] Token prefix (first 4 chars): ${tokenPrefix}`);

      if (!tokenPrefix.startsWith('EAAG') && !tokenPrefix.startsWith('EAA')) {
        console.error(`[Instagram Webhook] ❌ REJECTED: Token does not start with "EAAG" or "EAA"`);
        console.error(`[Instagram Webhook] Instagram DM replies require Page Access Token (EAAG)`);
        console.error(`[Instagram Webhook] Got token starting with: ${tokenPrefix}`);
        console.error(`[Instagram Webhook] Please re-authenticate using Facebook OAuth`);
        throw new Error(`Invalid token type: Expected Page Access Token (EAAG), got token starting with: ${tokenPrefix}`);
      }

      console.log(`[Instagram Webhook] ✅ Found valid Page Access Token (EAAG) for instagramAccountId: ${instagramAccountId}`);

      // Defensive logging: App mode and permissions check
      const appMode = process.env.NODE_ENV || 'development';
      console.log(`[Instagram Webhook] App mode: ${appMode}`);

      // Check token permissions via debug_token (optional, for debugging)
      try {
        const metaAppId = process.env.META_APP_ID;
        const metaAppSecret = process.env.META_APP_SECRET;
        
        if (metaAppId && metaAppSecret) {
          const debugResponse = await axios.get('https://graph.facebook.com/v18.0/debug_token', {
            params: {
              input_token: pageAccessToken,
              access_token: `${metaAppId}|${metaAppSecret}`
            }
          });
          
          if (debugResponse.data?.data) {
            const tokenData = debugResponse.data.data;
            console.log(`[Instagram Webhook] Token permissions:`, {
              app_id: tokenData.app_id,
              type: tokenData.type,
              scopes: tokenData.scopes || [],
              is_valid: tokenData.is_valid
            });
          }
        } else {
          console.warn(`[Instagram Webhook] META_APP_ID or META_APP_SECRET not set, skipping token permission check`);
        }
      } catch (debugError: any) {
        // Don't fail if debug_token fails, just log
        console.warn(`[Instagram Webhook] Could not check token permissions:`, debugError.message);
      }

      // Build endpoint URL
      // Instagram Messaging API requires /me/messages (NOT /{instagramAccountId}/messages)
      const endpointUrl = `https://graph.facebook.com/v18.0/me/messages`;
      console.log(`[Instagram Webhook] Endpoint URL: ${endpointUrl}`);
      console.log(`[Instagram Webhook] Recipient ID: ${senderId}`);
      console.log(`[Instagram Webhook] Message length: ${messageText.length} characters`);

      // Build payload (EXACT format required by Instagram Messaging API)
      const payload = {
        recipient: {
          id: senderId
        },
        message: {
          text: messageText
        }
      };

      console.log(`[Instagram Webhook] Payload:`, JSON.stringify(payload, null, 2));

      // Send message via Instagram Graph API
      // POST /v18.0/me/messages
      // Authorization: Bearer <PAGE_ACCESS_TOKEN> (EAAG)
      const response = await axios.post(
        endpointUrl,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Instagram Webhook] ✅ Instagram reply sent successfully`);
      console.log(`[Instagram Webhook] Response:`, JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      const errorData = error.response?.data?.error || {};
      const errorCode = errorData.code;
      const errorMessage = errorData.message || error.message;

      // Guard for error code 3 or 200: Application does not have the capability
      if (errorCode === 3 || errorCode === 200) {
        console.error(`[Instagram Webhook] ❌ ERROR CODE ${errorCode}: Application does not have the capability to make this API call`);
        console.error(`[Instagram Webhook] Instagram Messaging requires Page Access Token (EAAG) from Facebook OAuth`);
        console.error(`[Instagram Webhook] Check:`);
        console.error(`[Instagram Webhook]   - App is PUBLISHED (not in Development mode)`);
        console.error(`[Instagram Webhook]   - instagram_manage_messages permission is Advanced`);
        console.error(`[Instagram Webhook]   - Instagram Messaging product is added to the app`);
        console.error(`[Instagram Webhook]   - App Review is approved for instagram_manage_messages`);
        console.error(`[Instagram Webhook]   - Token prefix is EAAG (Page Access Token)`);
        console.error(`[Instagram Webhook] Full error:`, JSON.stringify(error.response?.data, null, 2));
      } else {
        console.error(`[Instagram Webhook] ❌ Error sending Instagram message (code: ${errorCode}):`, errorMessage);
        console.error(`[Instagram Webhook] Full error:`, JSON.stringify(error.response?.data, null, 2));
      }

      throw error;
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
   * Uses AIContextService for consistent KB and system prompt resolution
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
      // Use centralized AI context service for consistent behavior across all platforms
      const { aiContextService } = await import('../services/aiContext.service');
      
      // Resolve AI context (KB + system prompt) from organization
      const aiContext = await aiContextService.resolveFromOrganization(organizationId);
      
      if (!aiContext) {
        console.log(`[${platform} AI] No AI context available (no KB or settings configured)`);
        return;
      }

      if (!aiContext.autoReplyEnabled) {
        console.log(`[${platform} AI] Auto-reply is disabled in settings`);
        return;
      }

      console.log(`[${platform} AI] Using context:`, {
        collectionNames: aiContext.collectionNames,
        systemPromptLength: aiContext.systemPrompt.length,
        userId: aiContext.userId
      });

      const ragResponse = await pythonRagService.chat({
        query: userMessage,
        collectionNames: aiContext.collectionNames,
        topK: 5,
        threadId: conversation._id.toString(),
        systemPrompt: aiContext.systemPrompt
      });

      const aiResponse = ragResponse.answer;
      if (!aiResponse) {
        console.error(`[${platform} AI] No response from RAG service`);
        return;
      }

      console.log(`[${platform} AI] Got response: ${aiResponse.substring(0, 100)}...`);

      // Save AI message
      await Message.create({
        conversationId: conversation._id,
        sender: 'ai',
        text: aiResponse,
        type: 'message',
        timestamp: new Date(),
        metadata: {
          generatedBy: 'rag-service',
          collectionNames: aiContext.collectionNames,
          systemPromptUsed: true
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


