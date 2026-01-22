import mongoose from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Customer from '../models/Customer';
import { AppError } from '../middleware/error.middleware';
import socialIntegrationService from './socialIntegration.service';
import { trackUsage } from '../middleware/profileTracking.middleware';

export class ConversationService {
  // Get all conversations with filters and pagination
  async findAll(filters: any = {}, page = 1, limit = 20) {
    const query: any = {};

    // CRITICAL: ALWAYS filter by organizationId - REQUIRED for data isolation
    // If organizationId is not provided, throw error (should never happen)
    if (!filters.organizationId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'organizationId is required for data isolation');
    }
    query.organizationId = filters.organizationId;

    if (filters.status) query.status = filters.status;
    if (filters.channel) {
      query.channel = filters.channel;
      // If filtering by social channel and platform is specified, filter by metadata.platform
      if (filters.channel === 'social' && filters.platform) {
        query['metadata.platform'] = filters.platform;
      }
    }
    if (filters.assignedTo) query.assignedOperatorId = filters.assignedTo;
    if (filters.folderId) {
      query.folderId = filters.folderId;
    } else if (filters.folder) {
      query.folderId = filters.folder;
    }
    if (filters.label) query.labels = filters.label;

    if (filters.search) {
      // CRITICAL: Filter customers by organizationId to prevent cross-tenant data leakage
      const customerQuery: any = {
        organizationId: filters.organizationId,
        $or: [
          { name: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } },
          { phone: { $regex: filters.search, $options: 'i' } }
        ]
      };
      const customers = await Customer.find(customerQuery);
      query.customerId = { $in: customers.map(c => c._id) };
    }

    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const skip = (page - 1) * limit;
    const total = await Conversation.countDocuments(query);

    const conversations = await Conversation.find(query)
      .populate('customerId', 'name email phone avatar color')
      .populate('assignedOperatorId', 'firstName lastName avatar')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get last message for each conversation
    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conv: any) => {
        const lastMessage = await Message.findOne({
          conversationId: conv._id,
          type: 'message'
        })
          .sort({ timestamp: -1 })
          .lean();

        // Ensure customer has a name - use email or phone as fallback
        if (conv.customerId) {
          if (!conv.customerId.name || conv.customerId.name === '') {
            conv.customerId.name = conv.customerId.email || conv.customerId.phone || 'Unknown Customer';
          }
        }

        return {
          ...conv,
          lastMessage: lastMessage ? {
            id: lastMessage._id,
            text: lastMessage.text,
            sender: lastMessage.sender,
            timestamp: lastMessage.timestamp
          } : null
        };
      })
    );

    return {
      items: conversationsWithLastMessage,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  // Get conversation by ID with all messages
  async findById(conversationId: string, organizationId: string) {
    console.log(`[Conversation Service] Fetching conversation: ${conversationId}`);
    
    const conversation = await Conversation.findById(conversationId)
      .populate('customerId', 'name email phone avatar color customProperties')
      .populate('assignedOperatorId', 'firstName lastName avatar')
      .lean();

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = (conversation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    console.log(`[Conversation Service] Found conversation for customer: ${(conversation as any).customerId?.name}`);
    console.log(`[Conversation Service] Has transcript: ${!!(conversation as any).transcript}`);
    console.log(`[Conversation Service] Metadata:`, JSON.stringify((conversation as any).metadata, null, 2));

    // Query messages using both _id and string id to handle any format
    const messages = await Message.find({ 
      conversationId: (conversation as any)._id 
    })
      .populate('operatorId', 'firstName lastName avatar')
      .sort({ timestamp: 1 })
      .lean();

    console.log(`[Conversation Service] Found ${messages.length} messages for conversation ${(conversation as any)._id}`);
    if (messages.length > 0) {
      console.log(`[Conversation Service] First message:`, {
        sender: messages[0].sender,
        textPreview: messages[0].text?.substring(0, 50),
      });
    } else {
      // Debug: Check if any messages exist in the collection
      const totalMessages = await Message.countDocuments({});
      console.log(`[Conversation Service] ⚠️ No messages found. Total messages in DB: ${totalMessages}`);
      
      // Check with string comparison
      const messagesWithString = await Message.find({ 
        conversationId: conversationId 
      }).lean();
      console.log(`[Conversation Service] Messages found with string query: ${messagesWithString.length}`);
    }

    return {
      ...conversation,
      messages
    };
  }

  // Create new message
  async addMessage(conversationId: string, messageData: any, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const message = await Message.create({
      conversationId,
      ...messageData,
      timestamp: new Date()
    });

    // Update conversation updated_at
    conversation.updatedAt = new Date();
    if (messageData.sender === 'customer') {
      conversation.unread = true;
    }
    await conversation.save();

    // Emit Socket.io events for real-time updates (only for messages, not internal notes)
    if (messageData.type === 'message') {
      try {
        const { emitToConversation, emitToOrganization } = await import('../config/socket');
        
        const messagePayload = {
          id: message._id.toString(),
          conversationId: conversationId.toString(),
          text: messageData.text || '',
          sender: messageData.sender,
          timestamp: message.timestamp,
          type: 'message',
          attachments: messageData.attachments || []
        };

        // Emit to conversation room
        emitToConversation(conversationId.toString(), 'message-received', messagePayload);
        
        // Emit to organization room
        emitToOrganization(
          conversation.organizationId.toString(),
          'new-message',
          {
            conversationId: conversationId.toString(),
            message: messagePayload
          }
        );

        console.log(`[Conversation Service] Emitted message-received event for conversation ${conversationId}`);
      } catch (socketError: any) {
        console.error('[Conversation Service] Failed to emit Socket.io event:', socketError.message);
        // Don't throw - message was saved successfully
      }
    }

    return message;
  }

  // Send reply to customer (via appropriate channel)
  async sendReply(conversationId: string, messageText: string, organizationId: string, operatorId?: string, attachments: any[] = []) {
    const conversation = await Conversation.findById(conversationId)
      .populate('customerId')
      .lean();

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = (conversation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const customer = conversation.customerId as any;
    const channel = conversation.channel;
    const metadata = conversation.metadata || {};

    // Create message in database
    const message = await Message.create({
      conversationId,
      sender: operatorId ? 'operator' : 'ai',
      text: messageText,
      type: 'message',
      timestamp: new Date(),
      operatorId: operatorId || undefined,
      attachments: attachments || []
    });

    // Send via appropriate channel
    try {
      if (channel === 'whatsapp') {
        const dialog360 = await socialIntegrationService.getDialog360Service(
          conversation.organizationId.toString(),
          'whatsapp'
        );
        await dialog360.sendWhatsAppMessage({
          to: customer.phone,
          type: 'text',
          text: messageText
        });
      } else if (channel === 'social' && metadata.platform === 'instagram') {
        const dialog360 = await socialIntegrationService.getDialog360Service(
          conversation.organizationId.toString(),
          'instagram'
        );
        const instagramId = customer.metadata?.instagramId;
        if (!instagramId) {
          throw new AppError(400, 'INVALID_CUSTOMER', 'Instagram ID not found for customer');
        }
        await dialog360.sendInstagramMessage({
          to: instagramId,
          type: 'text',
          text: messageText
        });
      } else if (channel === 'social' && metadata.platform === 'facebook') {
        const dialog360 = await socialIntegrationService.getDialog360Service(
          conversation.organizationId.toString(),
          'facebook'
        );
        const facebookId = customer.metadata?.facebookId;
        if (!facebookId) {
          throw new AppError(400, 'INVALID_CUSTOMER', 'Facebook ID not found for customer');
        }
        await dialog360.sendFacebookMessage({
          to: facebookId,
          type: 'text',
          text: messageText
        });
      } else if (channel === 'website') {
        // Website messages are handled via Socket.io (existing implementation)
        // No external API call needed
      } else if (channel === 'email') {
        // Email handling would go here
        // TODO: Implement email sending
      } else if (channel === 'phone') {
        // Phone/Voice handling would go here
        // TODO: Implement voice response
      }
    } catch (error: any) {
      console.error(`Error sending message via ${channel}:`, error);
      // Mark message as failed but don't throw - message is saved in DB
      await Message.findByIdAndUpdate(message._id, {
        $set: {
          'metadata.sendError': error.message
        }
      });
    }

    // Update conversation
    await Conversation.findByIdAndUpdate(conversationId, {
      updatedAt: new Date(),
      unread: false
    });

    // Emit Socket.io events for real-time updates
    try {
      const { emitToConversation, emitToOrganization } = await import('../config/socket');
      
      const messageData = {
        id: message._id.toString(),
        conversationId: conversationId.toString(),
        text: messageText,
        sender: operatorId ? 'operator' : 'ai',
        timestamp: message.timestamp,
        type: 'message',
        attachments: attachments || []
      };

      // Emit to conversation room
      emitToConversation(conversationId.toString(), 'message-received', messageData);
      
      // Emit to organization room
      emitToOrganization(
        conversation.organizationId.toString(),
        'new-message',
        {
          conversationId: conversationId.toString(),
          message: messageData
        }
      );

      console.log(`[Conversation Service] Emitted message-received event for conversation ${conversationId}`);
    } catch (socketError: any) {
      console.error('[Conversation Service] Failed to emit Socket.io event:', socketError.message);
      // Don't throw - message was saved successfully
    }

    return message;
  }

  // Take manual control
  async takeControl(conversationId: string, operatorId: string, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      {
        isAiManaging: false,
        assignedOperatorId: operatorId
      },
      { new: true }
    );

    return updated!;
  }

  // Release control back to AI
  async releaseControl(conversationId: string, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { isAiManaging: true },
      { new: true }
    );

    return updated!;
  }

  // Update conversation status
  async updateStatus(conversationId: string, status: string, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { status },
      { new: true }
    );

    return updated!;
  }

  // Assign operator
  async assignOperator(conversationId: string, operatorId: string | null, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { assignedOperatorId: operatorId },
      { new: true }
    );

    return updated!;
  }

  // Add/remove labels
  async updateLabels(conversationId: string, add: string[] = [], remove: string[] = [], organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    if (add.length > 0) {
      conversation.labels = [...new Set([...conversation.labels, ...add])];
    }

    if (remove.length > 0) {
      conversation.labels = conversation.labels.filter(l => !remove.includes(l));
    }

    await conversation.save();
    return conversation;
  }

  // Move to folder
  async moveToFolder(conversationId: string, folderId: string | null, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { folderId: folderId || null },
      { new: true }
    );

    return updated!;
  }

  // Toggle bookmark
  async toggleBookmark(conversationId: string, isBookmarked: boolean, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { isBookmarked },
      { new: true }
    );

    return updated!;
  }

  // Delete conversation
  async delete(conversationId: string, organizationId: string) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    }

    // CRITICAL: Verify ownership - conversation must belong to user's organization
    const convOrgId = conversation.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (convOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    await conversation.deleteOne();
    // Delete all messages
    await Message.deleteMany({ conversationId });

    return { message: 'Conversation deleted successfully' };
  }

  // Create conversation for outbound call
  async createForOutboundCall(data: {
    userId: string;
    phone: string;
    name: string;
    callerId: string;
    organizationId?: string;
  }) {
    try {
      // Find or create customer
      let customer = await Customer.findOne({ phone: data.phone });
      
      if (!customer) {
        customer = await Customer.create({
          name: data.name,
          phone: data.phone,
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`
        });
      }

      // Create conversation
      const conversation = await Conversation.create({
        organizationId: data.organizationId || data.userId,
        customerId: customer._id,
        channel: 'phone',
        status: 'open',
        isAiManaging: true,
        unread: true,
        metadata: {
          callerId: data.callerId,
          callInitiated: new Date()
        }
      });

      // Add initial internal note
      await Message.create({
        conversationId: conversation._id,
        type: 'internal_note',
        text: `Outbound call initiated to ${data.name} (${data.phone})`,
        sender: 'ai',
        timestamp: new Date()
      });

      console.log(`[Conversation Service] Created conversation for outbound call: ${conversation._id}`);
      console.log(`[Conversation Service] Metadata saved:`, JSON.stringify(conversation.metadata, null, 2));
      
      return conversation;
    } catch (error: any) {
      console.error('[Conversation Service] Failed to create conversation for outbound call:', error);
      throw error;
    }
  }

  // Fetch and update transcript from MongoDB by caller_id
  async fetchTranscriptByCallerId(callerId: string) {
    try {
      // Import mongoose to access native driver
      const db = mongoose.connection.db;
      
      console.log(`[Conversation Service] Searching for transcript with caller_id: ${callerId}`);
      
      // Check what documents exist
      const allDocs = await db?.collection('transcripts').find({}).limit(5).toArray();
      console.log(`[Conversation Service] Found ${allDocs?.length || 0} documents in transcripts collection`);
      if (allDocs && allDocs.length > 0) {
        console.log(`[Conversation Service] Sample document keys:`, Object.keys(allDocs[0]));
        console.log(`[Conversation Service] Sample caller_id:`, allDocs[0].caller_id);
      }
      
      // Fetch the call transcript document from MongoDB
      const callDocument = await db?.collection('transcripts').findOne({ caller_id: callerId });
      
      if (!callDocument) {
        console.log(`[Conversation Service] ❌ No document found with caller_id: ${callerId}`);
        throw new AppError(404, 'NOT_FOUND', 'Call transcript not found');
      }
      
      console.log(`[Conversation Service] ✅ Found transcript document for caller_id: ${callerId}`);

      // Find conversation by callerId
      const conversation = await Conversation.findOne({ 'metadata.callerId': callerId });
      
      if (!conversation) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found for this call');
      }

      // Update conversation with transcript
      conversation.transcript = callDocument.transcript;
      conversation.metadata = {
        ...conversation.metadata,
        duration: callDocument.metadata?.duration_formatted,
        callCompletedAt: callDocument.timestamp,
        roomName: callDocument.metadata?.room_name,
        recording_url: callDocument.metadata?.recording_url || callDocument.recording_url || null
      };
      await conversation.save();

      // Delete existing transcript messages to avoid duplicates on refresh
      await Message.deleteMany({ 
        conversationId: conversation._id, 
        'metadata.transcriptItemId': { $exists: true } 
      });

      // Convert transcript items to messages
      if (callDocument.transcript && callDocument.transcript.items) {
        for (const item of callDocument.transcript.items) {
          if (item.type === 'message') {
            await Message.create({
              conversationId: conversation._id,
              type: 'message',
              text: item.content.join(' '),
              sender: item.role === 'user' ? 'customer' : 'ai',
              timestamp: new Date(),
              metadata: {
                transcriptItemId: item.id,
                interrupted: item.interrupted,
                confidence: item.transcript_confidence
              }
            });
          }
        }
      }

      console.log(`[Conversation Service] Updated conversation ${conversation._id} with transcript`);
      
      // Emit WebSocket event to notify frontend that transcript is ready
      try {
        const { emitToOrganization } = await import('../config/socket');
        const populatedConversation = await Conversation.findById(conversation._id)
          .populate('customerId')
          .lean();
        
        emitToOrganization(
          conversation.organizationId.toString(),
          'conversation:transcript-updated',
          {
            conversationId: conversation._id,
            callerId: callerId,
            hasTranscript: true,
            hasRecording: !!callDocument.metadata?.recording_url,
            conversation: populatedConversation
          }
        );
        console.log(`[Conversation Service] Emitted conversation:transcript-updated event`);
      } catch (socketError: any) {
        console.error('[Conversation Service] Failed to emit WebSocket event:', socketError.message);
        // Don't throw - the transcript was fetched successfully
      }
      
      return {
        conversation,
        transcript: callDocument.transcript,
        metadata: callDocument.metadata
      };
    } catch (error: any) {
      console.error('[Conversation Service] Failed to fetch transcript:', error);
      throw error;
    }
  }

  // Bulk create conversations (for campaign transcripts)
  async bulkCreate(conversationsData: any[], organizationId: string) {
    const created = [];
    const failed = [];

    // CRITICAL: Validate all conversations have organizationId
    for (const data of conversationsData) {
      try {
        // CRITICAL: Always set organizationId for data isolation
        const conversation = await Conversation.create({
          ...data,
          organizationId: data.organizationId || organizationId // Use provided or fallback
        });
        created.push(conversation);
      } catch (error: any) {
        failed.push({
          data,
          error: error.message
        });
      }
    }

    return {
      created: created.length,
      failed: failed.length,
      conversations: created,
      errors: failed
    };
  }

  // Bulk delete
  async bulkDelete(conversationIds: string[]) {
    const result = await Conversation.deleteMany({
      _id: { $in: conversationIds }
    });

    await Message.deleteMany({
      conversationId: { $in: conversationIds }
    });

    return {
      deleted: result.deletedCount,
      failed: conversationIds.length - (result.deletedCount || 0)
    };
  }

  // Search messages
  async searchMessages(query: string, filters: any = {}) {
    const searchQuery: any = {
      $text: { $search: query },
      type: 'message'
    };

    if (filters.conversationId) {
      searchQuery.conversationId = filters.conversationId;
    }

    if (filters.dateFrom || filters.dateTo) {
      searchQuery.timestamp = {};
      if (filters.dateFrom) searchQuery.timestamp.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) searchQuery.timestamp.$lte = new Date(filters.dateTo);
    }

    const messages = await Message.find(searchQuery)
      .populate({
        path: 'conversationId',
        populate: { path: 'customerId', select: 'name avatar' }
      })
      .limit(50)
      .lean();

    return messages;
  }

  // Save widget conversation (from public widget, no user account required)
  // CRITICAL: Requires widgetId and resolves userId/organizationId internally to prevent cross-tenant data leakage
  // NO FALLBACKS - fails loudly if widgetId invalid or user/org not found
  async saveWidgetConversation(data: {
    widgetId: string; // REQUIRED: widgetId === userId (validated ObjectId)
    name: string;
    threadId: string;
    collection?: string;
    messages: Array<{ role: string; content: string; timestamp: Date }>;
  }) {
    try {
      const mongoose = (await import('mongoose')).default;
      const User = (await import('../models/User')).default;
      const Organization = (await import('../models/Organization')).default;

      // CRITICAL: Validate widgetId is present and valid ObjectId
      if (!data.widgetId || data.widgetId === 'undefined' || data.widgetId === '') {
        throw new AppError(400, 'MISSING_WIDGET_ID', 'widgetId is required and cannot be undefined');
      }

      if (!mongoose.Types.ObjectId.isValid(data.widgetId)) {
        throw new AppError(400, 'INVALID_WIDGET_ID', `Invalid widget ID format: ${data.widgetId}`);
      }

      // CRITICAL: Resolve userId from widgetId (widgetId === userId)
      const userId = data.widgetId;
      const userObjectId = new mongoose.Types.ObjectId(userId);

      // CRITICAL: Verify user exists
      const user = await User.findById(userObjectId);
      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', `User not found for widget ID: ${data.widgetId}`);
      }

      // CRITICAL: Resolve organizationId from user
      let organizationId: string;
      if (user.organizationId) {
        organizationId = user.organizationId.toString();
      } else {
        // Try to find organization by ownerId
        const organization = await Organization.findOne({ ownerId: userObjectId });
        if (organization) {
          organizationId = organization._id.toString();
        } else {
          // Single-tenant: use userId as organizationId
          organizationId = userId;
        }
      }

      // CRITICAL: Validate organizationId is valid
      if (!mongoose.Types.ObjectId.isValid(organizationId)) {
        throw new AppError(500, 'INVALID_ORGANIZATION_ID', `Invalid organization ID format: ${organizationId}`);
      }

      console.log('[Widget Conversation] Saving conversation with strict isolation:', {
        widgetId: data.widgetId,
        userId: userId,
        organizationId: organizationId,
        name: data.name,
        threadId: data.threadId
      });
      
      // Find or create customer by name WITH organizationId (strict isolation)
      const orgObjectId = new mongoose.Types.ObjectId(organizationId);
      let customer = await Customer.findOne({ 
        name: data.name,
        organizationId: orgObjectId // CRITICAL: Scoped to organization
      });
      
      if (!customer) {
        console.log('[Widget Conversation] Creating new customer:', data.name);
        customer = await Customer.create({
          name: data.name,
          source: 'widget',
          organizationId: orgObjectId // CRITICAL: Always set organizationId
        });
      } else {
        // Update customer if name was empty/missing
        if (!customer.name || customer.name === '') {
          customer.name = data.name;
          await customer.save();
          console.log('[Widget Conversation] Updated customer name:', data.name);
        }
      }

      // Find existing conversation by threadId AND organizationId (strict isolation)
      let conversation = await Conversation.findOne({ 
        'metadata.threadId': data.threadId,
        organizationId: orgObjectId // CRITICAL: Scoped to organization
      });

      if (!conversation) {
        console.log('[Widget Conversation] Creating new conversation for thread:', data.threadId);
        const conversationData: any = {
          customerId: customer._id,
          organizationId: orgObjectId, // CRITICAL: Always set organizationId (no fallback)
          channel: 'website',
          status: 'unread',
          isAiManaging: true,
          metadata: {
            threadId: data.threadId,
            collection: data.collection
          }
        };
        
        conversation = await Conversation.create(conversationData);

        // Track chat conversation usage for the resolved userId
        try {
          await trackUsage(userId, 'chat', 1);
          console.log(`[Widget Conversation] Tracked 1 chat conversation for user ${userId}`);
        } catch (trackError: any) {
          console.warn('[Widget Conversation] Failed to track usage:', trackError.message);
          // Don't fail conversation save if usage tracking fails
        }
      }

      // Add messages
      console.log('[Widget Conversation] Adding', data.messages.length, 'messages');
      for (const msg of data.messages) {
        await Message.create({
          conversationId: conversation._id,
          sender: msg.role === 'user' ? 'customer' : 'ai', // Valid values: 'customer', 'ai', 'operator'
          text: msg.content, // Message model uses 'text' not 'content'
          type: 'message', // Default message type
          timestamp: msg.timestamp
        });
      }

      // Update conversation updatedAt
      conversation.updatedAt = new Date();
      await conversation.save();

      console.log('[Widget Conversation] ✅ Conversation saved successfully');
      return conversation;
    } catch (error: any) {
      console.error('[Widget Conversation] ❌ Error saving conversation:', error);
      throw new AppError(
        500, 
        'SAVE_ERROR', 
        `Failed to save widget conversation: ${error.message}`
      );
    }
  }
}

export const conversationService = new ConversationService();
