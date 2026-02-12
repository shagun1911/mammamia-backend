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
import KnowledgeBase from '../models/KnowledgeBase';
import Settings from '../models/Settings';
import { aiBehaviorService } from '../services/aiBehavior.service';
import { getEcommerceCredentials } from '../utils/ecommerce.util';

// Helper function to resolve a single KB ID to collection name(s) - SAME AS CHATBOT
async function resolveSingleKBId(kbId: string, userId: string): Promise<string[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
  const KnowledgeBaseDocument = (await import('../models/KnowledgeBaseDocument')).default;
  const resolved: string[] = [];

  if (kbId.startsWith('kb_')) {
    const chatbotKB = await ChatbotKnowledgeBase.findOne({ 
      kb_id: kbId, 
      userId: userObjectId,
      status: 'ready'
    }).lean();
    if (chatbotKB?.collection_name) {
      resolved.push(chatbotKB.collection_name);
    }
  } else if (kbId.startsWith('KBDoc_')) {
    const voiceAgentKB = await KnowledgeBaseDocument.findOne({ 
      document_id: kbId, 
      userId: userObjectId 
    }).lean();
    if (voiceAgentKB?.linked_chatbot_kb_id) {
      const chatbotKB = await ChatbotKnowledgeBase.findOne({ 
        kb_id: voiceAgentKB.linked_chatbot_kb_id,
        userId: userObjectId,
        status: 'ready'
      }).lean();
      if (chatbotKB?.collection_name) {
        resolved.push(chatbotKB.collection_name);
      }
    }
  } else if (mongoose.Types.ObjectId.isValid(kbId) && kbId.length === 24) {
    const kb = await KnowledgeBase.findById(kbId).lean();
    if (kb?.collectionName) {
      resolved.push(kb.collectionName);
    }
  }

  return resolved;
}

// Helper function to resolve multiple KB IDs to collection names - SAME AS CHATBOT
async function resolveMultipleKBIds(ids: string[], userId: string): Promise<string[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
  const KnowledgeBaseDocument = (await import('../models/KnowledgeBaseDocument')).default;
  const resolvedNames: string[] = [];

  const chatbotKbIds = ids.filter((id: string) => id.startsWith('kb_'));
  const voiceAgentKbIds = ids.filter((id: string) => id.startsWith('KBDoc_'));
  const legacyKbIds = ids.filter((id: string) => 
    !id.startsWith('kb_') && !id.startsWith('KBDoc_') && mongoose.Types.ObjectId.isValid(id)
  );

  if (chatbotKbIds.length > 0) {
    const chatbotKBs = await ChatbotKnowledgeBase.find({ 
      kb_id: { $in: chatbotKbIds },
      userId: userObjectId,
      status: 'ready'
    }).select('collection_name').lean();
    resolvedNames.push(...chatbotKBs.map((kb: any) => kb.collection_name).filter(Boolean));
  }

  if (voiceAgentKbIds.length > 0) {
    const voiceAgentKBs = await KnowledgeBaseDocument.find({ 
      document_id: { $in: voiceAgentKbIds },
      userId: userObjectId 
    }).select('linked_chatbot_kb_id').lean();
    
    const linkedChatbotKbIds = voiceAgentKBs.map((kb: any) => kb.linked_chatbot_kb_id).filter(Boolean);
    
    if (linkedChatbotKbIds.length > 0) {
      const chatbotKBs = await ChatbotKnowledgeBase.find({ 
        kb_id: { $in: linkedChatbotKbIds },
        userId: userObjectId,
        status: 'ready'
      }).select('collection_name').lean();
      resolvedNames.push(...chatbotKBs.map((kb: any) => kb.collection_name).filter(Boolean));
    }
  }

  if (legacyKbIds.length > 0) {
    const objectIds = legacyKbIds
      .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
      .map((id: string) => new mongoose.Types.ObjectId(id));
    
    if (objectIds.length > 0) {
      const knowledgeBases = await KnowledgeBase.find({ 
        _id: { $in: objectIds } 
      }).select('collectionName').lean();
      resolvedNames.push(...knowledgeBases.map((kb: any) => kb.collectionName).filter(Boolean));
    }
  }

  return [...new Set(resolvedNames)];
}

// Helper function to determine collection names - IMPROVED: Merges Settings + AI Behavior like Website Chatbot
async function determineCollectionNames(userId: string, knowledgeBaseId?: string): Promise<string[]> {
  const collectionNamesSet = new Set<string>(); // Use Set to merge and deduplicate
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // 1. If explicit knowledgeBaseId provided, resolve and add it
  if (knowledgeBaseId) {
    const resolved = await resolveSingleKBId(knowledgeBaseId, userId);
    resolved.forEach(name => collectionNamesSet.add(name));
    if (resolved.length > 0) {
      console.log('[Social Webhook] Added explicit knowledgeBaseId to collection set:', resolved);
    }
  }

  // 2. Always check Settings (merge all sources)
  const settings = await Settings.findOne({ userId: userObjectId });
  
  if (settings) {
    const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
    const userChatbotKBs = await ChatbotKnowledgeBase.find({ 
      userId: userObjectId, 
      status: 'ready' 
    }).select('collection_name').lean();
    
    const userCollectionMap = new Map<string, string>();
    userChatbotKBs.forEach((kb: any) => {
      if (kb.collection_name) {
        userCollectionMap.set(kb.collection_name.toLowerCase(), kb.collection_name);
      }
    });
    
    const userLegacyKBs = await KnowledgeBase.find({ userId: userObjectId }).select('collectionName').lean();
    userLegacyKBs.forEach((kb: any) => {
      if (kb.collectionName) {
        userCollectionMap.set(kb.collectionName.toLowerCase(), kb.collectionName);
      }
    });
    
    // Priority 1: Merge defaultKnowledgeBaseNames array (VALIDATE)
    if (settings.defaultKnowledgeBaseNames && Array.isArray(settings.defaultKnowledgeBaseNames) && settings.defaultKnowledgeBaseNames.length > 0) {
      settings.defaultKnowledgeBaseNames.forEach((name: any) => {
        if (name && typeof name === 'string' && name.trim() !== '') {
          const nameLower = name.trim().toLowerCase();
          const actualName = userCollectionMap.get(nameLower);
          if (actualName) {
            collectionNamesSet.add(actualName);
          }
        }
      });
    }

    // Priority 2: Merge defaultKnowledgeBaseIds array
    if (settings.defaultKnowledgeBaseIds && Array.isArray(settings.defaultKnowledgeBaseIds) && settings.defaultKnowledgeBaseIds.length > 0) {
      const resolvedNames = await resolveMultipleKBIds(settings.defaultKnowledgeBaseIds, userId);
      resolvedNames.forEach(name => collectionNamesSet.add(name));
    }

    // Priority 3: Merge defaultKnowledgeBaseName (legacy)
    if (settings.defaultKnowledgeBaseName && typeof settings.defaultKnowledgeBaseName === 'string' && settings.defaultKnowledgeBaseName.trim() !== '') {
      const nameLower = settings.defaultKnowledgeBaseName.trim().toLowerCase();
      const actualName = userCollectionMap.get(nameLower);
      if (actualName) {
        collectionNamesSet.add(actualName);
      }
    }

    // Priority 4: Merge defaultKnowledgeBaseId (legacy)
    if (settings.defaultKnowledgeBaseId) {
      const resolved = await resolveSingleKBId(settings.defaultKnowledgeBaseId.toString(), userId);
      resolved.forEach(name => collectionNamesSet.add(name));
    }
  }

  // 3. NEW: Always check AI Behavior (merge, not just fallback) - SAME AS CHATBOT
  const aiBehavior = await aiBehaviorService.get(userId);
  if (aiBehavior.knowledgeBaseId) {
    const resolved = await resolveSingleKBId(aiBehavior.knowledgeBaseId.toString(), userId);
    resolved.forEach(name => collectionNamesSet.add(name));
    if (resolved.length > 0) {
      console.log('[Social Webhook] ✅ Merged AI Behavior knowledgeBaseId:', resolved);
    }
  }

  const collectionNames = Array.from(collectionNamesSet);

  if (collectionNames.length === 0) {
    throw new Error('No knowledge base configured. Please configure a knowledge base in Settings → Knowledge Base.');
  }

  console.log('[Social Webhook] ✅ Final merged collection names (Settings + AI Behavior):', collectionNames);
  return collectionNames;
}

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
              } else if (change.field === 'statuses' && change.value?.statuses) {
                await this.handleWhatsAppStatus(change.value);
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
          
          // Check for Facebook Lead Ads (changes field)
          if (entry.changes && entry.changes.length > 0) {
            for (const change of entry.changes) {
              if (change.field === 'leadgen' && change.value) {
                // Facebook Lead Ad submission
                console.log('[Messenger Webhook] Received Lead Ads submission');
                await this.processFacebookLeadAd(pageId, change.value, entry);
              }
            }
          }
          
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
   * Handle WhatsApp message status updates (delivered, read, failed, etc.)
   */
  private async handleWhatsAppStatus(data: any) {
    try {
      const statuses = data.statuses;
      if (!statuses || !Array.isArray(statuses) || statuses.length === 0) {
        return;
      }

      for (const status of statuses) {
        const messageId = status.id; // WhatsApp message ID (wamid)
        const statusValue = status.status; // sent, delivered, read, failed
        const timestamp = status.timestamp ? new Date(parseInt(status.timestamp) * 1000) : new Date();
        const recipientId = status.recipient_id;
        const errors = status.errors || [];

        if (!messageId) {
          console.warn('[WhatsApp Status Update] Missing messageId in status update');
          continue;
        }

        // Find message by messageId
        const message = await Message.findOne({ messageId: messageId });

        if (!message) {
          // Log warning but don't crash - message might be from another system or already deleted
          console.log('[WhatsApp Status Update] Message not found for messageId:', messageId, {
            status: statusValue,
            recipientId
          });
          continue;
        }

        // Update status fields based on status value
        const updateData: any = {
          status: statusValue
        };

        if (statusValue === 'sent') {
          // Status changed to sent (from accepted)
          updateData.status = 'sent';
        } else if (statusValue === 'delivered') {
          updateData.status = 'delivered';
          updateData.deliveredAt = timestamp;
        } else if (statusValue === 'read') {
          updateData.status = 'read';
          updateData.readAt = timestamp;
          // Also set deliveredAt if not already set (read implies delivered)
          if (!message.deliveredAt) {
            updateData.deliveredAt = timestamp;
          }
        } else if (statusValue === 'failed') {
          updateData.status = 'failed';
          updateData.failedAt = timestamp;
          // Extract error information
          if (errors.length > 0) {
            const firstError = errors[0];
            updateData.errorCode = firstError.code?.toString() || undefined;
            updateData.errorMessage = firstError.title || firstError.message || undefined;
          }
        }

        // Update message record
        await Message.findByIdAndUpdate(message._id, updateData);

        // Structured logging
        console.log('[WhatsApp Status Update]', {
          messageId,
          status: statusValue,
          recipientId,
          errorCode: updateData.errorCode || null,
          errorMessage: updateData.errorMessage || null,
          timestamp: timestamp.toISOString()
        });
      }
    } catch (error: any) {
      // Log error but don't throw - webhook must always return 200 OK
      console.error('[WhatsApp Status Update] Error processing status update:', error.message);
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
      // CRITICAL: MUST filter by userId existence to prevent orphan integrations
      const integration = await SocialIntegration.findOne({
        'credentials.phoneNumberId': phoneNumberId,
        platform: 'whatsapp',
        status: 'connected',
        userId: { $exists: true, $ne: null } // CRITICAL: Only get integrations with userId
      });

      if (!integration) {
        console.warn(`[WhatsApp Webhook] No integration found for phone number ID: ${phoneNumberId}`);
        console.warn(`[WhatsApp Webhook] Searched for: credentials.phoneNumberId === ${phoneNumberId}, platform: whatsapp, status: connected, userId exists`);
        return;
      }

      // RUNTIME ASSERTION: If integration.userId missing → THROW
      if (!integration.userId) {
        console.error(`[WhatsApp Webhook] ❌ CRITICAL: Integration found but userId is missing! Integration ID: ${integration._id}`);
        throw new Error(`Integration ${integration._id} is missing userId. This is a data integrity issue.`);
      }

      console.log(`[WhatsApp Webhook] ✅ Found integration with userId: ${integration.userId.toString()}`);

      // Find or create customer
      let customer = await Customer.findOne({
        phone: from,
        organizationId: integration.organizationId
      });

      if (!customer) {
        // Try to get customer name from message contacts if available
        const contactName = data.contacts?.[0]?.profile?.name || from;
        customer = await Customer.create({
          organizationId: integration.organizationId,
          phone: from,
          name: contactName,
          source: 'whatsapp'
        });
      } else if (!customer.name || customer.name === customer.phone) {
        // Update customer name if available from contacts
        const contactName = data.contacts?.[0]?.profile?.name;
        if (contactName) {
          customer.name = contactName;
          await customer.save();
        }
      }

      // Find or create conversation (check any status to find existing conversation)
      let conversation = await Conversation.findOne({
        customerId: customer._id,
        channel: 'whatsapp',
        'metadata.phoneNumberId': phoneNumberId
      });

      if (!conversation) {
        conversation = await Conversation.create({
          organizationId: integration.organizationId,
          customerId: customer._id,
          channel: 'whatsapp',
          status: 'open', // Set to 'open' so it appears in conversations tab
          isAiManaging: true,
          metadata: {
            phoneNumberId,
            externalMessageId: messageId
          }
        });
        
        // Emit new conversation event so it appears immediately in UI
        emitToOrganization(integration.organizationId.toString(), 'new-conversation', {
          conversationId: conversation._id?.toString() || '',
          customer: {
            id: customer._id,
            name: customer.name
          }
        });
      } else {
        // Update existing conversation status if it was closed
        if (conversation.status === 'closed') {
          conversation.status = 'open';
          conversation.updatedAt = new Date();
          await conversation.save();
        }
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

      // Generate chatbot reply using Settings + AIBehavior ONLY
      if (conversation.isAiManaging) {
        // CRITICAL: userId MUST come from integration.userId (SINGLE SOURCE OF TRUTH)
        const userId = integration.userId?.toString();
        
        if (!userId) {
          console.error('[WhatsApp Webhook] ❌ CRITICAL: integration.userId is missing. Cannot proceed without userId.');
          throw new Error('integration.userId is required for data isolation. Integration is missing userId field.');
        }
        
        console.log('[WhatsApp Webhook] ✅ Using userId from integration.userId:', userId);

        try {
          // 1. KNOWLEDGE BASE: Fetch from Settings using userId ONLY
          let collectionNames: string[] = [];
          try {
            collectionNames = await determineCollectionNames(userId);
            console.log('[WhatsApp Webhook] ✅ Resolved Collection Names from Settings:', collectionNames);
          } catch (error: any) {
            console.error('[WhatsApp Webhook] ❌ Failed to resolve KB from Settings:', error.message);
            return; // NO REPLY if KB not found
          }

          // 2. SYSTEM PROMPT: Fetch from AIBehavior using userId ONLY
          const aiBehavior = await aiBehaviorService.get(userId);
          let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
            'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';
          
          console.log('[WhatsApp Webhook] ✅ Using system prompt from AIBehavior.chatAgent.systemPrompt (length:', systemPrompt.length, ')');

          // 4. Get WooCommerce credentials if available (OPTIONAL)
          const ecommerceCredentials = await getEcommerceCredentials(userId);
          
          // 5. Append enhanced instructions to system prompt (SAME as ChatbotController)
          systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
          systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
          systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
          systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
          systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
          
          if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
            systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
            systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
            systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
          } else {
            systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
          }

          // 6. Get API keys for LLM generation (REQUIRED for Python backend)
          let provider: string | undefined;
          let apiKey: string | undefined;
          try {
            const { apiKeysService } = await import('../services/apiKeys.service');
            const apiKeys = await apiKeysService.getApiKeys(userId);
            
            provider = apiKeys.llmProvider;
            apiKey = apiKeys.apiKey;
            console.log('[WhatsApp Webhook] ✅ API keys fetched for LLM generation for userId:', userId, ':', { provider });
          } catch (error: any) {
            console.error('[WhatsApp Webhook] ❌ Failed to fetch API keys for userId:', userId, ':', error.message);
            throw error; // THROW ERROR instead of warning
          }

          console.log('[WhatsApp Webhook] Using ChatbotController logic:', {
            userId,
            collectionNames,
            systemPromptLength: systemPrompt.length,
            hasProvider: !!provider,
            hasApiKey: !!apiKey,
            hasEcommerceCredentials: !!ecommerceCredentials
          });

          // 7. Call RAG service with EXACT SAME parameters as ChatbotController
          const ragResponse = await pythonRagService.chat({
            query: messageText,
            collectionNames: collectionNames,
            threadId: conversation._id.toString(),
            systemPrompt: systemPrompt,
            provider: provider,
            apiKey: apiKey,
            ecommerceCredentials: ecommerceCredentials,
            topK: 5,
            elaborate: false,
            skipHistory: false
          });

          const aiResponse = ragResponse.answer;
          if (!aiResponse) {
            console.error('[WhatsApp Webhook] No response from RAG service');
            return;
          }

          console.log(`[WhatsApp Webhook] Got reply from RAG: ${aiResponse.substring(0, 100)}...`);

          // Save AI message
          await Message.create({
            conversationId: conversation._id,
            organizationId: conversation.organizationId,
            customerId: customer._id,
            sender: 'ai',
            text: aiResponse,
            type: 'message',
            timestamp: new Date(),
            metadata: {
              generatedBy: 'rag-service',
              collectionNames: collectionNames
            }
          });

          // Send response via WhatsApp
          const dialog360 = await socialIntegrationService.getDialog360Service(userId, 'whatsapp');
          await dialog360.sendWhatsAppMessage({
            to: from,
            type: 'text',
            text: aiResponse
          });

          // Update conversation
          conversation.updatedAt = new Date();
          conversation.unread = false;
          await conversation.save();

          // Emit socket event
          emitToOrganization(conversation.organizationId.toString(), 'new-message', {
            conversationId: conversation._id.toString(),
            message: {
              text: aiResponse,
              sender: 'ai',
              timestamp: new Date()
            }
          });
        } catch (error: any) {
          console.error('[WhatsApp Webhook] AI auto-reply error:', error.message);
          // Don't throw - we don't want to break the webhook flow
        }
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
      // CRITICAL: MUST filter by userId existence to prevent orphan integrations
      // OAuth stores: credentials.facebookPageId and credentials.pageAccessToken
      // Webhook only provides page_id, so we use it as the primary key
      const integration = await SocialIntegration.findOne({
        'credentials.facebookPageId': pageId,
        platform: 'facebook',
        status: 'connected',
        userId: { $exists: true, $ne: null } // CRITICAL: Only get integrations with userId
      });

      if (!integration) {
        console.warn(`[Messenger Webhook] No integration found for page_id: ${pageId}`);
        console.warn(`[Messenger Webhook] Searched for: credentials.facebookPageId === ${pageId}, platform: facebook, status: connected, userId exists`);
        return;
      }

      // RUNTIME ASSERTION: If integration.userId missing → THROW
      if (!integration.userId) {
        console.error(`[Messenger Webhook] ❌ CRITICAL: Integration found but userId is missing! Integration ID: ${integration._id}`);
        throw new Error(`Integration ${integration._id} is missing userId. This is a data integrity issue.`);
      }

      console.log(`[Messenger Webhook] ✅ Found integration with userId: ${integration.userId.toString()}`);

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

      const organizationId = integration.organizationId?.toString();
      
      if (!organizationId) {
        console.error('[Messenger Webhook] No organizationId found in integration');
        return;
      }

      // CRITICAL: Create conversation FIRST so it's visible in UI immediately
      // Get actual organizationId for customer storage
      const UserForCustomer = (await import('../models/User')).default;
      let customerOrgId = integration.organizationId;
      if (mongoose.Types.ObjectId.isValid(integration.organizationId)) {
        const user = await UserForCustomer.findById(integration.organizationId);
        if (user && user.organizationId) {
          customerOrgId = user.organizationId;
        }
      }

      // Find or create customer
      let customer = await Customer.findOne({
        'metadata.facebookId': senderPsid,
        organizationId: customerOrgId
      });

      if (!customer) {
        // Try to fetch sender name from Meta Graph API
        let senderName = senderPsid;
        try {
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
            organizationId: customerOrgId,
            name: senderName,
            source: 'facebook',
            metadata: { facebookId: senderPsid }
          });
      } else if (!customer.name || customer.name === customer.metadata?.facebookId) {
        // Update customer name if it's still an ID
        try {
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

      // Find or create conversation (check any status to find existing conversation)
      let conversation = await Conversation.findOne({
        customerId: customer._id,
        channel: 'social',
        'metadata.platform': 'facebook',
        'metadata.facebookPageId': pageId
      });

        // CRITICAL: Get actual organizationId for conversation storage (so it's visible to user)
        const UserForConv = (await import('../models/User')).default;
        let conversationOrgId = integration.organizationId;
        if (mongoose.Types.ObjectId.isValid(integration.organizationId)) {
          const user = await UserForConv.findById(integration.organizationId);
          if (user && user.organizationId) {
            conversationOrgId = user.organizationId;
            console.log(`[Messenger Webhook] Using actual organizationId for conversation: ${conversationOrgId}`);
          }
        }

        if (!conversation) {
          conversation = await Conversation.create({
            organizationId: conversationOrgId, // Use actual organizationId so user can see it
            customerId: customer._id,
            channel: 'social',
            status: 'open', // Set to 'open' so it appears in conversations tab
            isAiManaging: true,
            metadata: {
              platform: 'facebook',
              facebookPageId: pageId
            }
          });
          
          // Emit new conversation event so it appears immediately in UI
          emitToOrganization(conversationOrgId.toString(), 'new-conversation', {
            conversationId: conversation._id?.toString() || '',
            customer: {
              id: customer._id,
              name: customer.name
            }
          });
        } else {
          // Update existing conversation status if it was closed
          if (conversation.status === 'closed') {
            conversation.status = 'open';
            conversation.updatedAt = new Date();
            await conversation.save();
          }
        }

        // Save user message FIRST (use conversation's organizationId)
        await Message.create({
          conversationId: conversation._id,
          organizationId: conversation.organizationId, // Use conversation's organizationId
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

        // Update conversation
        conversation.updatedAt = new Date();
        conversation.unread = true;
        await conversation.save();

        // Emit socket event for new message
        emitToOrganization(conversation.organizationId.toString(), 'new-message', {
          conversationId: conversation._id?.toString() || '',
          message: {
            text: messageText,
            sender: 'customer',
            timestamp: new Date()
          }
        });

      // Generate chatbot reply using Settings + AIBehavior ONLY
      // CRITICAL: userId MUST come from integration.userId (SINGLE SOURCE OF TRUTH)
      const userId = integration.userId?.toString();
      
      if (!userId) {
        console.error('[Messenger Webhook] ❌ CRITICAL: integration.userId is missing. Cannot proceed without userId.');
        throw new Error('integration.userId is required for data isolation. Integration is missing userId field.');
      }
      
      console.log('[Messenger Webhook] ✅ Using userId from integration.userId:', userId);

      if (!conversation.isAiManaging) {
        console.log('[Messenger Webhook] AI management is disabled for this conversation');
        return;
      }

      // 1. KNOWLEDGE BASE: Fetch from Settings using userId ONLY
      let collectionNames: string[] = [];
      try {
        collectionNames = await determineCollectionNames(userId);
        console.log('[Messenger Webhook] ✅ Resolved Collection Names from Settings:', collectionNames);
      } catch (error: any) {
        console.error('[Messenger Webhook] ❌ Failed to resolve KB from Settings:', error.message);
        // TEMPORARY DEMO FALLBACK: Send Hindi message about LangChain
        console.log('[Messenger Webhook] 🎭 Using demo fallback message (Hindi - LangChain)');
        const fallbackMessage = 'LangChain एक शक्तिशाली framework है जो AI applications बनाने के लिए उपयोग किया जाता है। यह developers को LLMs (Large Language Models) के साथ काम करने में मदद करता है, RAG (Retrieval Augmented Generation) pipelines बनाता है, और complex AI workflows को manage करता है। LangChain Python और JavaScript दोनों में उपलब्ध है और यह AI-powered applications को बनाना आसान बनाता है।';
        
        try {
          // Send fallback message using Messenger Send API
          const { MetaOAuthService } = await import('../services/metaOAuth.service');
          const metaAppId = process.env.META_APP_ID || '';
          const metaAppSecret = process.env.META_APP_SECRET || '';
          const backendUrl = process.env.BACKEND_URL || '';
          
          const metaOAuth = new MetaOAuthService({
            appId: metaAppId,
            appSecret: metaAppSecret,
            redirectUri: `${backendUrl}/api/v1/social-integrations/facebook/oauth/callback`
          });

          const messageId = await metaOAuth.sendMessengerMessage(
            pageId,
            pageAccessToken,
            senderPsid,
            fallbackMessage
          );

          console.log(`[Messenger Webhook] ✅ Fallback message sent. Message ID: ${messageId || 'N/A'}`);

          // Save fallback message to database
          await Message.create({
            conversationId: conversation._id,
            organizationId: conversation.organizationId,
            customerId: customer._id,
            sender: 'ai',
            text: fallbackMessage,
            type: 'message',
            timestamp: new Date(),
            metadata: {
              externalId: messageId,
              platform: 'facebook',
              generatedBy: 'demo-fallback',
              isFallback: true
            }
          });

          // Update conversation
          conversation.updatedAt = new Date();
          conversation.unread = false;
          await conversation.save();

          // Emit socket event
          emitToOrganization(conversation.organizationId.toString(), 'new-message', {
            conversationId: conversation._id?.toString() || '',
            message: {
              text: fallbackMessage,
              sender: 'ai',
              timestamp: new Date()
            }
          });
        } catch (fallbackError: any) {
          console.error('[Messenger Webhook] ❌ Failed to send fallback message:', fallbackError.message);
        }
        return; // Exit after sending fallback
      }

      // 2. CHECK FOR ACTIVE AUTOMATIONS - If active, AI should collect contact details
      const Automation = (await import('../models/Automation')).default;
      const activeAutomation = await Automation.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        isActive: true,
        'nodes.service': 'facebook_message'
      });

      console.log('[Messenger Webhook] Active facebook_message automation:', activeAutomation ? 'YES' : 'NO');

      // 3. SYSTEM PROMPT: Fetch from AIBehavior using userId ONLY
      const aiBehavior = await aiBehaviorService.get(userId);
      let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
        'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';
      
      console.log('[Messenger Webhook] ✅ Using system prompt from AIBehavior.chatAgent.systemPrompt (length:', systemPrompt.length, ')');

      // Check if conversation already has extracted data
      const existingExtractedData = conversation.metadata?.extractedData || {};
      const hasName = !!existingExtractedData.name;
      const hasEmail = !!existingExtractedData.email;
      const hasPhone = !!existingExtractedData.phone;
      const hasDate = !!existingExtractedData.appointmentDate;
      const hasTime = !!existingExtractedData.appointmentTime;

      // If automation is active, modify system prompt to collect required information
      if (activeAutomation) {
        console.log('[Messenger Webhook] 🤖 Automation is active - AI will collect contact details');
        console.log('[Messenger Webhook] Existing data:', {
          hasName,
          hasEmail,
          hasPhone,
          hasDate,
          hasTime
        });

        systemPrompt += '\n\n=== SPECIAL INSTRUCTIONS FOR APPOINTMENT BOOKING ===\n';
        systemPrompt += 'The user wants to book an appointment. You MUST collect the following information in a conversational way:\n';
        
        if (!hasName) {
          systemPrompt += '1. Full name (if not already known)\n';
        }
        if (!hasEmail) {
          systemPrompt += '2. Email address\n';
        }
        if (!hasPhone) {
          systemPrompt += '3. Phone number (ask for country code too, e.g., +1 for US)\n';
        }
        if (!hasDate) {
          systemPrompt += '4. Preferred appointment date (ask for specific date like "February 10, 2024")\n';
        }
        if (!hasTime) {
          systemPrompt += '5. Preferred appointment time (ask for specific time like "2:00 PM" or "14:00")\n';
        }

        systemPrompt += '\nIMPORTANT:\n';
        systemPrompt += '- Ask for ONE piece of information at a time in a friendly, natural way\n';
        systemPrompt += '- Do NOT overwhelm the user with multiple questions at once\n';
        systemPrompt += '- After getting one detail, acknowledge it and ask for the next one\n';
        systemPrompt += '- Be conversational and friendly, not robotic\n';
        systemPrompt += '- Once you have ALL information, confirm the details with the user\n';
        systemPrompt += '- Say something like: "Perfect! Let me confirm: Your appointment is scheduled for [date] at [time]. We\'ll send a confirmation to [email] and call you at [phone] if needed."\n';
        systemPrompt += '\nExample flow:\n';
        systemPrompt += 'User: "I want to book an appointment"\n';
        systemPrompt += 'You: "Great! I\'d be happy to help you book an appointment. May I have your full name?"\n';
        systemPrompt += 'User: "John Doe"\n';
        systemPrompt += 'You: "Thank you, John! What\'s the best email address to send your confirmation to?"\n';
        systemPrompt += '...and so on.\n';
      }

      // 4. Get WooCommerce credentials if available (OPTIONAL)
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      // 5. Append enhanced instructions to system prompt (SAME as ChatbotController)
      systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
      systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
      systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
      systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
      systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
      
      if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
        systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
        systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
        systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
      } else {
        systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
      }

      // 6. Get API keys for LLM generation (REQUIRED for Python backend)
      let provider: string | undefined;
      let apiKey: string | undefined;
      try {
        const { apiKeysService } = await import('../services/apiKeys.service');
        const apiKeys = await apiKeysService.getApiKeys(userId);
        
        // CRITICAL: Validate API keys belong to the correct user
        if (apiKeys.userId && apiKeys.userId.toString() !== userId) {
          throw new Error(`API keys userId mismatch: expected ${userId}, got ${apiKeys.userId}`);
        }
        
        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;
        console.log('[Messenger Webhook] ✅ API keys fetched for LLM generation for userId:', userId, ':', { provider });
      } catch (error: any) {
        console.error('[Messenger Webhook] ❌ Failed to fetch API keys for userId:', userId, ':', error.message);
        throw error; // THROW ERROR instead of warning
      }

      console.log('[Messenger Webhook] Using ChatbotController logic:', {
        userId,
        collectionNames,
        systemPromptLength: systemPrompt.length,
        hasProvider: !!provider,
        hasApiKey: !!apiKey,
        hasEcommerceCredentials: !!ecommerceCredentials
      });

      // 7. Call RAG service with EXACT SAME parameters as ChatbotController
      const ragResponse = await pythonRagService.chat({
        query: messageText,
        collectionNames: collectionNames,
        threadId: conversation._id.toString(),
        systemPrompt: systemPrompt,
        provider: provider,
        apiKey: apiKey,
        ecommerceCredentials: ecommerceCredentials,
        topK: 5,
        elaborate: false,
        skipHistory: false
      });

      const botReply = ragResponse.answer;
      if (!botReply || botReply.trim() === '') {
        console.warn('[Messenger Webhook] No reply generated from RAG service');
        return;
      }

      console.log(`[Messenger Webhook] Got reply from RAG: ${botReply.substring(0, 100)}...`);
      console.log(`[Messenger Webhook] Sending reply to PSID: ${senderPsid}`);

      // Send reply immediately using Messenger Send API
      const { MetaOAuthService } = await import('../services/metaOAuth.service');
      const metaAppId = process.env.META_APP_ID || '';
      const metaAppSecret = process.env.META_APP_SECRET || '';
      const backendUrl = process.env.BACKEND_URL || '';
      
      const metaOAuth = new MetaOAuthService({
        appId: metaAppId,
        appSecret: metaAppSecret,
        redirectUri: `${backendUrl}/api/v1/social-integrations/facebook/oauth/callback`
      });

      // Send message
      const messageId = await metaOAuth.sendMessengerMessage(
        pageId,
        pageAccessToken,
        senderPsid, // PSID
        botReply
      );

      console.log(`[Messenger Webhook] ✅ Reply sent successfully. Message ID: ${messageId || 'N/A'}`);

      // Save bot reply to database (use same organizationId as conversation)
      await Message.create({
        conversationId: conversation._id,
        organizationId: conversation.organizationId, // Use conversation's organizationId
        customerId: customer._id,
        sender: 'ai',
        text: botReply,
        type: 'message',
        timestamp: new Date(),
        metadata: {
          externalId: messageId,
          platform: 'facebook',
          generatedBy: 'rag-service',
          collectionNames: collectionNames
        }
      });

      // Update conversation
      conversation.updatedAt = new Date();
      conversation.unread = false;
      await conversation.save();

      // Emit socket event
      emitToOrganization(conversation.organizationId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: botReply,
          sender: 'ai',
          timestamp: new Date()
        }
      });

      // If automation is active, extract contact data and trigger automation when ready
      if (activeAutomation) {
        console.log('[Messenger Webhook] 📊 Extracting contact data from conversation...');
        
        const conversationExtractionService = (await import('../services/conversationExtraction.service')).default;
        const extractedData = await conversationExtractionService.extractContactData(conversation._id.toString());
        
        console.log('[Messenger Webhook] Extracted data:', extractedData);
        console.log('[Messenger Webhook] Has all required data:', extractedData.hasAllRequiredData);

        // Only trigger automation if we have all required data
        if (extractedData.hasAllRequiredData) {
          console.log('[Messenger Webhook] ✅ All data collected! Triggering automation...');
          
          const { automationEngine } = await import('../services/automationEngine.service');
          
          // Update customer with extracted data
          if (extractedData.email && !customer.email) {
            customer.email = extractedData.email;
          }
          if (extractedData.phone && !customer.phone) {
            customer.phone = extractedData.phone;
          }
          if (extractedData.name && customer.name === senderPsid) {
            customer.name = extractedData.name;
          }
          await customer.save();
          console.log('[Messenger Webhook] ✅ Customer updated with extracted data');

          // Trigger automation with complete data
          automationEngine.triggerByEvent('facebook_message', {
            event: 'message_received',
            pageId: pageId,
            senderPsid: senderPsid,
            messageText: messageText,
            contactId: customer._id.toString(),
            conversationId: conversation._id.toString(),
            organizationId: conversation.organizationId.toString(),
            userId: integration.userId.toString(),
            contact: {
              name: extractedData.name || customer.name,
              email: extractedData.email || customer.email,
              phone: extractedData.phone || customer.phone,
              tags: customer.tags || []
            },
            // Include extracted appointment data
            appointmentDate: extractedData.appointmentDate,
            appointmentTime: extractedData.appointmentTime,
            extractedData: extractedData
          }, {
            organizationId: conversation.organizationId.toString(),
            userId: integration.userId.toString()
          }).catch(err => console.error('[Messenger Webhook] Automation trigger error:', err));
        } else {
          console.log('[Messenger Webhook] ⏳ Waiting for complete data before triggering automation...');
        }
      } else {
        console.log('[Messenger Webhook] No active automation - skipping trigger');
      }

    } catch (error: any) {
      console.error('[Messenger Webhook] Error processing message:', error.message || error);
    }
  }

  /**
   * Process Facebook Lead Ad submission and trigger automations
   */
  private async processFacebookLeadAd(
    pageId: string,
    leadData: any,
    entry: any
  ) {
    try {
      console.log('[Facebook Lead Ads] Processing lead submission for page:', pageId);
      console.log('[Facebook Lead Ads] Lead data:', JSON.stringify(leadData, null, 2));

      const leadgenId = leadData.leadgen_id;
      const formId = leadData.form_id;
      const adId = leadData.ad_id;
      const createdTime = leadData.created_time;

      if (!leadgenId || !formId) {
        console.warn('[Facebook Lead Ads] Missing leadgen_id or form_id');
        return;
      }

      // Find integration
      const integration = await SocialIntegration.findOne({
        'credentials.facebookPageId': pageId,
        platform: 'facebook',
        status: 'connected',
        userId: { $exists: true, $ne: null }
      });

      if (!integration) {
        console.warn(`[Facebook Lead Ads] No integration found for page_id: ${pageId}`);
        return;
      }

      if (!integration.userId) {
        console.error(`[Facebook Lead Ads] Integration missing userId: ${integration._id}`);
        return;
      }

      const userId = integration.userId.toString();
      console.log(`[Facebook Lead Ads] Found integration with userId: ${userId}`);

      // Fetch lead details from Facebook Graph API
      const pageAccessToken = integration.credentials?.pageAccessToken;
      if (!pageAccessToken) {
        console.error('[Facebook Lead Ads] Missing page access token');
        return;
      }

      let leadDetails: any = {};
      try {
        const response = await axios.get(
          `https://graph.facebook.com/v18.0/${leadgenId}?access_token=${pageAccessToken}`
        );
        leadDetails = response.data;
        console.log('[Facebook Lead Ads] Lead details fetched:', JSON.stringify(leadDetails, null, 2));
      } catch (error: any) {
        console.error('[Facebook Lead Ads] Failed to fetch lead details:', error.message);
        // Continue with what we have
      }

      // Parse field data
      const fieldData: Record<string, string> = {};
      if (leadDetails.field_data && Array.isArray(leadDetails.field_data)) {
        leadDetails.field_data.forEach((field: any) => {
          fieldData[field.name] = field.values?.[0] || '';
        });
      }

      console.log('[Facebook Lead Ads] Parsed field data:', fieldData);

      // Create contact from lead data
      const Customer = (await import('../models/Customer')).default;
      const Organization = (await import('../models/Organization')).default;

      // Resolve organization
      const UserModel = (await import('../models/User')).default;
      const user = await UserModel.findById(userId);
      let organizationId = integration.organizationId?.toString();
      
      if (!organizationId && user?.organizationId) {
        organizationId = user.organizationId.toString();
      } else if (!organizationId) {
        organizationId = userId; // Fallback to userId
      }

      // Create or update customer
      const contactEmail = fieldData.email || fieldData.EMAIL || '';
      const contactPhone = fieldData.phone || fieldData.phone_number || fieldData.PHONE || '';
      const contactName = fieldData.full_name || fieldData.name || fieldData.NAME || contactEmail || 'Facebook Lead';

      // Build query filter
      const orFilters: any[] = [];
      if (contactEmail) {
        orFilters.push({ email: contactEmail });
      }
      if (contactPhone) {
        orFilters.push({ phone: contactPhone });
      }

      let customer: any = null;
      
      if (orFilters.length > 0) {
        customer = await Customer.findOne({
          organizationId,
          $or: orFilters
        });
      }

      if (!customer) {
        const newCustomer = await Customer.create({
          organizationId,
          name: contactName,
          email: contactEmail || undefined,
          phone: contactPhone || undefined,
          source: 'facebook_lead_ad',
          metadata: {
            facebookLeadId: leadgenId,
            formId: formId,
            adId: adId,
            createdTime: createdTime,
            fieldData: fieldData
          }
        });
        customer = newCustomer;
        console.log('[Facebook Lead Ads] ✅ Contact created:', customer._id);
      } else {
        // Update existing contact with lead data
        if (!customer.metadata) customer.metadata = {};
        customer.metadata.facebookLeadId = leadgenId;
        customer.metadata.lastLeadFormId = formId;
        customer.metadata.lastLeadAdId = adId;
        await customer.save();
        console.log('[Facebook Lead Ads] ✅ Contact updated:', customer._id);
      }

      // Trigger automations for facebook_lead
      const { automationEngine } = await import('../services/automationEngine.service');
      
      console.log('[Facebook Lead Ads] Triggering automations...');
      await automationEngine.triggerByEvent('facebook_lead', {
        event: 'lead_created',
        pageId: pageId,
        formId: formId,
        adId: adId,
        leadgenId: leadgenId,
        contactId: customer._id.toString(),
        organizationId: organizationId,
        userId: userId,
        contact: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tags: customer.tags || []
        },
        fieldData: fieldData,
        createdTime: createdTime
      }, {
        organizationId: organizationId,
        userId: userId
      });

      console.log('[Facebook Lead Ads] ✅ Lead processed successfully');
    } catch (error: any) {
      console.error('[Facebook Lead Ads] Error processing lead:', error.message || error);
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
      // CRITICAL: MUST filter by userId existence to prevent orphan integrations
      const integration = await SocialIntegration.findOne({
        'credentials.instagramAccountId': instagramAccountId,
        platform: 'instagram',
        status: 'connected',
        userId: { $exists: true, $ne: null } // CRITICAL: Only get integrations with userId
      });

      if (!integration) {
        console.warn(`[Instagram Webhook] No integration found for instagramAccountId: ${instagramAccountId}`);
        console.warn(`[Instagram Webhook] Searched for: credentials.instagramAccountId === ${instagramAccountId}, platform: instagram, status: connected, userId exists`);
        return;
      }

      // RUNTIME ASSERTION: If integration.userId missing → THROW
      if (!integration.userId) {
        console.error(`[Instagram Webhook] ❌ CRITICAL: Integration found but userId is missing! Integration ID: ${integration._id}`);
        throw new Error(`Integration ${integration._id} is missing userId. This is a data integrity issue.`);
      }

      console.log(`[Instagram Webhook] ✅ Found integration with userId: ${integration.userId.toString()}`);

      console.log(`[Instagram] Integration found for instagramAccountId: ${instagramAccountId}`);

      const organizationId = integration.organizationId?.toString();
      
      if (!organizationId) {
        console.error('[Instagram Webhook] No organizationId found in integration');
        return;
      }

      // CRITICAL: Create conversation FIRST so it's visible in UI immediately
      // CRITICAL: userId MUST come from integration.userId (SINGLE SOURCE OF TRUTH)
      const userId = integration.userId?.toString();
      
      if (!userId) {
        console.error('[Instagram Webhook] ❌ CRITICAL: integration.userId is missing. Cannot proceed without userId.');
        throw new Error('integration.userId is required for data isolation. Integration is missing userId field.');
      }
      
      console.log('[Instagram Webhook] ✅ Using userId from integration.userId:', userId);
      
      const UserForCustomer = (await import('../models/User')).default;
      let customerOrgId: string | mongoose.Types.ObjectId = organizationId;
      
      // Get actual organizationId for conversation storage (so it's visible to user)
      if (mongoose.Types.ObjectId.isValid(organizationId)) {
        const user = await UserForCustomer.findById(organizationId);
        if (user && user.organizationId) {
          customerOrgId = user.organizationId.toString();
          console.log(`[Instagram Webhook] Using actual organizationId for conversation: ${customerOrgId}`);
        }
      }

      // Find or create customer
      let customer = await Customer.findOne({
        'metadata.instagramId': senderId,
        organizationId: customerOrgId.toString()
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
            organizationId: customerOrgId.toString(),
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

        // Find or create conversation (check any status to find existing conversation)
        let conversation = await Conversation.findOne({
          customerId: customer._id,
          channel: 'social',
          'metadata.platform': 'instagram',
          'metadata.instagramAccountId': instagramAccountId
        });

        if (!conversation) {
          conversation = await Conversation.create({
            organizationId: customerOrgId.toString(), // Use actual organizationId
            customerId: customer._id,
            channel: 'social',
            status: 'open', // Set to 'open' so it appears in conversations tab
            isAiManaging: true,
            metadata: {
              platform: 'instagram',
              instagramAccountId: instagramAccountId
            }
          });
          
          // Emit new conversation event so it appears immediately in UI
          emitToOrganization(customerOrgId.toString(), 'new-conversation', {
            conversationId: conversation._id?.toString() || '',
            customer: {
              id: customer._id,
              name: customer.name
            }
          });
        } else {
          // Update existing conversation status if it was closed
          if (conversation.status === 'closed') {
            conversation.status = 'open';
            conversation.updatedAt = new Date();
            await conversation.save();
          }
        }

      // Save user message FIRST
      await Message.create({
        conversationId: conversation._id,
        organizationId: customerOrgId.toString(), // Use actual organizationId
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

      // Update conversation
      conversation.updatedAt = new Date();
      conversation.unread = true;
      await conversation.save();

      // Emit socket event for new message
      emitToOrganization(customerOrgId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: messageText,
          sender: 'customer',
          timestamp: new Date()
        }
      });

      // Generate chatbot reply using Settings + AIBehavior ONLY
      // userId is already set above (from integration.userId)
      
      if (!conversation.isAiManaging) {
        console.log('[Instagram Webhook] AI management is disabled for this conversation');
        return;
      }

      // 1. KNOWLEDGE BASE: Fetch from Settings using userId ONLY
      let collectionNames: string[] = [];
      try {
        collectionNames = await determineCollectionNames(userId);
        console.log('[Instagram Webhook] ✅ Resolved Collection Names from Settings for userId:', userId, ':', collectionNames);
      } catch (error: any) {
        console.error('[Instagram Webhook] ❌ Failed to resolve KB from Settings for userId:', userId, ':', error.message);
        return; // NO REPLY if KB not found
      }

      // 2. SYSTEM PROMPT: Fetch from AIBehavior using userId ONLY
      const aiBehavior = await aiBehaviorService.get(userId);
      let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
        'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';
      
      console.log('[Instagram Webhook] ✅ Using system prompt from AIBehavior.chatAgent.systemPrompt for userId:', userId, '(length:', systemPrompt.length, ')');

      // 4. Get WooCommerce credentials if available (OPTIONAL)
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      // 5. Append enhanced instructions to system prompt (SAME as ChatbotController)
      systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
      systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
      systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
      systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
      systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
      
      if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
        systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
        systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
        systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
      } else {
        systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
      }

      // 6. Get API keys for LLM generation (REQUIRED for Python backend)
      let provider: string | undefined;
      let apiKey: string | undefined;
      try {
        const { apiKeysService } = await import('../services/apiKeys.service');
        const apiKeys = await apiKeysService.getApiKeys(userId);
        
        // CRITICAL: Validate API keys belong to the correct user
        if (apiKeys.userId && apiKeys.userId.toString() !== userId) {
          throw new Error(`API keys userId mismatch: expected ${userId}, got ${apiKeys.userId}`);
        }
        
        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;
        console.log('[Instagram Webhook] ✅ API keys fetched for LLM generation for userId:', userId, ':', { provider });
      } catch (error: any) {
        console.error('[Instagram Webhook] ❌ Failed to fetch API keys for userId:', userId, ':', error.message);
        throw error; // THROW ERROR instead of warning
      }

      console.log('[Instagram Webhook] Using ChatbotController logic:', {
        userId,
        collectionNames,
        systemPromptLength: systemPrompt.length,
        hasProvider: !!provider,
        hasApiKey: !!apiKey,
        hasEcommerceCredentials: !!ecommerceCredentials
      });

      // 7. Generate AI reply using RAG service with EXACT SAME parameters as ChatbotController
      console.log(`[Instagram Webhook] Generating AI reply for message: ${messageText.substring(0, 100)}...`);
      
      const ragResponse = await pythonRagService.chat({
        query: messageText,
        collectionNames: collectionNames,
        threadId: conversation._id.toString(),
        systemPrompt: systemPrompt,
        provider: provider,
        apiKey: apiKey,
        ecommerceCredentials: ecommerceCredentials,
        topK: 5,
        elaborate: false,
        skipHistory: false
      });

      const botReply = ragResponse.answer;
      if (!botReply || botReply.trim() === '') {
        console.warn('[Instagram Webhook] No reply generated from RAG service');
        return;
      }

      console.log(`[Instagram Webhook] Got reply from RAG: ${botReply.substring(0, 100)}...`);
      console.log(`[Instagram Webhook] Sending reply...`);

      // Send reply immediately using Instagram Messaging API
      await this.sendInstagramReply(instagramAccountId, senderId, botReply, integration);

      console.log(`[Instagram Webhook] ✅ Reply sent successfully`);

      // Save bot reply to database
      await Message.create({
        conversationId: conversation._id,
        organizationId: customerOrgId.toString(), // Use actual organizationId
        customerId: customer._id,
        sender: 'ai',
        text: botReply,
        type: 'message',
        timestamp: new Date(),
        metadata: {
          platform: 'instagram',
          generatedBy: 'rag-service',
          collectionNames: collectionNames
        }
      });

      // Update conversation
      conversation.updatedAt = new Date();
      conversation.unread = false;
      await conversation.save();

      // Emit socket event
      emitToOrganization(customerOrgId.toString(), 'new-message', {
        conversationId: conversation._id?.toString() || '',
        message: {
          text: botReply,
          sender: 'ai',
          timestamp: new Date()
        }
      });
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

      // Generate chatbot reply using Settings + AIBehavior ONLY
      if (conversation.isAiManaging) {
        // CRITICAL: userId MUST come from integration.userId (SINGLE SOURCE OF TRUTH)
        const userId = integration.userId?.toString();
        
        if (!userId) {
          console.error('[Instagram Webhook] ❌ CRITICAL: integration.userId is missing. Cannot proceed without userId.');
          throw new Error('integration.userId is required for data isolation. Integration is missing userId field.');
        }
        
        console.log('[Instagram Webhook] ✅ Using userId from integration.userId:', userId);

        try {
          // 1. KNOWLEDGE BASE: Fetch from Settings using userId ONLY
          let collectionNames: string[] = [];
          try {
            collectionNames = await determineCollectionNames(userId);
            console.log('[Instagram Webhook] ✅ Resolved Collection Names from Settings:', collectionNames);
          } catch (error: any) {
            console.error('[Instagram Webhook] ❌ Failed to resolve KB from Settings:', error.message);
            return; // NO REPLY if KB not found
          }

          // 2. SYSTEM PROMPT: Fetch from AIBehavior using userId ONLY
          const aiBehavior = await aiBehaviorService.get(userId);
          let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
            'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';
          
          console.log('[Instagram Webhook] ✅ Using system prompt from AIBehavior.chatAgent.systemPrompt (length:', systemPrompt.length, ')');

          // 4. Get WooCommerce credentials if available (OPTIONAL)
          const ecommerceCredentials = await getEcommerceCredentials(userId);
          
          // 5. Append enhanced instructions to system prompt (SAME as ChatbotController)
          systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
          systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
          systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
          systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
          systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
          
          if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
            systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
            systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
            systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
          } else {
            systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
          }

          // 6. Get API keys for LLM generation (REQUIRED for Python backend)
          let provider: string | undefined;
          let apiKey: string | undefined;
          try {
            const { apiKeysService } = await import('../services/apiKeys.service');
            const apiKeys = await apiKeysService.getApiKeys(userId);
            provider = apiKeys.llmProvider;
            apiKey = apiKeys.apiKey;
            console.log('[Instagram Webhook] ✅ API keys fetched for LLM generation:', { provider });
          } catch (error: any) {
            console.warn('[Instagram Webhook] ⚠️  Failed to fetch API keys:', error.message);
          }

          console.log('[Instagram Webhook] Using ChatbotController logic:', {
            userId,
            collectionNames,
            systemPromptLength: systemPrompt.length,
            hasProvider: !!provider,
            hasApiKey: !!apiKey,
            hasEcommerceCredentials: !!ecommerceCredentials
          });

          // 7. Call RAG service with EXACT SAME parameters as ChatbotController
          const ragResponse = await pythonRagService.chat({
            query: messageText,
            collectionNames: collectionNames,
            threadId: conversation._id.toString(),
            systemPrompt: systemPrompt,
            provider: provider,
            apiKey: apiKey,
            ecommerceCredentials: ecommerceCredentials,
            topK: 5,
            elaborate: false,
            skipHistory: false
          });

          const aiResponse = ragResponse.answer;
          if (!aiResponse) {
            console.error('[Instagram Webhook] No response from RAG service');
            return;
          }

          console.log(`[Instagram Webhook] Got reply from RAG: ${aiResponse.substring(0, 100)}...`);

          // Send reply via Instagram
          const instagramAccountId = integration.credentials?.instagramAccountId;
          if (instagramAccountId) {
            await this.sendInstagramReply(instagramAccountId, senderId, aiResponse, integration);
          }

          // Save AI message
          await Message.create({
            conversationId: conversation._id,
            organizationId: conversation.organizationId,
            customerId: customer._id,
            sender: 'ai',
            text: aiResponse,
            type: 'message',
            timestamp: new Date(),
            metadata: {
              platform: 'instagram',
              generatedBy: 'rag-service',
              collectionNames: collectionNames
            }
          });

          // Update conversation
          conversation.updatedAt = new Date();
          conversation.unread = false;
          await conversation.save();

          // Emit socket event
          emitToOrganization(conversation.organizationId.toString(), 'new-message', {
            conversationId: conversation._id.toString(),
            message: {
              text: aiResponse,
              sender: 'ai',
              timestamp: new Date()
            }
          });
        } catch (error: any) {
          console.error('[Instagram Webhook] AI auto-reply error:', error.message);
          // Don't throw - we don't want to break the webhook flow
        }
      }

      // Trigger automations for instagram_message (non-blocking)
      const { automationEngine } = await import('../services/automationEngine.service');
      
      console.log('[Instagram Webhook] Triggering automations for message received...');
      automationEngine.triggerByEvent('instagram_message', {
        event: 'message_received',
        instagramAccountId: recipientId,
        senderId: senderId,
        messageText: messageText,
        contactId: customer._id.toString(),
        conversationId: conversation._id.toString(),
        organizationId: integration.organizationId.toString(),
        userId: integration.userId.toString(),
        contact: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tags: customer.tags || []
        }
      }, {
        organizationId: integration.organizationId.toString(),
        userId: integration.userId.toString()
      }).catch(err => console.error('[Instagram Webhook] Automation trigger error:', err));

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
   * DEPRECATED: triggerAIReply - REMOVED
   * This function used aiContextService which is no longer used for social webhooks.
   * All social webhook handlers now use Settings + AIBehavior directly.
   * This function has been removed to prevent accidental usage.
   */
  private async triggerAIReply_DEPRECATED(
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


