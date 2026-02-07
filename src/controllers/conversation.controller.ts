import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ConversationService } from '../services/conversation.service';
import { successResponse, paginatedResponse } from '../utils/response.util';
import { gcsService } from '../services/gcs.service';
import { AppError } from '../middleware/error.middleware';

export class ConversationController {
  private conversationService: ConversationService;

  constructor() {
    this.conversationService = new ConversationService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 100, ...filters } = req.query;

      // CRITICAL: ALWAYS filter by organization/user to ensure data isolation
      // Use organizationId if available, otherwise fallback to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID or User ID not found');
      }

      // Sync pending batch call conversations before returning list
      // This ensures conversations are always materialized even if background sync failed
      try {
        const BatchCall = (await import('../models/BatchCall')).default;
        const { batchCallingService } = await import('../services/batchCalling.service');
        const mongoose = (await import('mongoose')).default;
        const userId = req.user?._id;

        // Find ALL batch calls that haven't been synced (regardless of status in database)
        // We'll check the Python API status in real-time
        const pendingBatches = await BatchCall.find({
          $and: [
            {
              $or: [
                { userId: userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId.toString()) },
                { organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString()) }
              ]
            },
            { conversations_synced: { $ne: true } },
            {
              $or: [
                { syncErrorCount: { $exists: false } },
                { syncErrorCount: { $lt: 5 } }
              ]
            }
          ]
        }).lean() as any[];

        if (pendingBatches.length > 0) {
          console.log(`[Conversation Controller] 🔄 Found ${pendingBatches.length} batch calls to check for sync`);

          // Check each batch call status and sync if completed
          // Process asynchronously to not block the response
          pendingBatches.forEach(async (batch) => {
            try {
              // Check real-time status from Python API
              const status = await batchCallingService.getBatchJobStatus(batch.batch_call_id);
              
              // Update database with latest status
              await BatchCall.updateOne(
                { batch_call_id: batch.batch_call_id },
                {
                  $set: {
                    status: status.status,
                    total_calls_dispatched: status.total_calls_dispatched || batch.total_calls_dispatched,
                    total_calls_scheduled: status.total_calls_scheduled || batch.total_calls_scheduled,
                    total_calls_finished: status.total_calls_finished || batch.total_calls_finished,
                    last_updated_at_unix: status.last_updated_at_unix || Math.floor(Date.now() / 1000)
                  }
                }
              );
              
              // If completed, sync conversations
              if (status.status === 'completed') {
                console.log(`[Conversation Controller] 🚀 Batch call ${batch.batch_call_id} completed! Syncing conversations...`);
                await batchCallingService.syncBatchCallConversations(
                  batch.batch_call_id,
                  organizationId.toString()
                );
              }
            } catch (err: any) {
              console.error(
                `[Conversation Controller] ❌ Failed to check/sync batch call ${batch.batch_call_id}:`,
                err.message
              );
            }
          });
        }
      } catch (syncError: any) {
        // Don't fail the request if batch sync fails
        console.error('[Conversation Controller] ⚠️ Batch sync error (non-blocking):', syncError.message);
      }

      const orgFilters: any = {
        ...filters,
        organizationId: organizationId.toString() // ALWAYS set organizationId
      };

      const result = await this.conversationService.findAll(
        orgFilters,
        Number(page),
        Number(limit)
      );
      res.json(paginatedResponse(
        result.items,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total
      ));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.findById(req.params.conversationId, organizationId.toString());
      res.json(successResponse(conversation));
    } catch (error) {
      next(error);
    }
  };

  addMessage = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { text, sender } = req.body;
      const operatorId = sender === 'operator' ? req.user._id : null;

      // Handle file attachments if any
      let attachments: any[] = [];
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        const files = req.files as Express.Multer.File[];
        try {
          attachments = await Promise.all(
            files.map(async (file) => {
              const fileUrl = await gcsService.uploadFile(
                file.buffer,
                file.originalname,
                file.mimetype,
                'conversations/attachments'
              );
              return {
                type: file.mimetype,
                url: fileUrl,
                filename: file.originalname,
                size: file.size
              };
            })
          );
        } catch (gcsError: any) {
          console.error('[Conversation Controller] GCS upload error:', gcsError);
          throw new AppError(
            500,
            'FILE_UPLOAD_FAILED',
            gcsError.message || 'Failed to upload file. Please check GCS configuration.'
          );
        }
      }

      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      // Use sendReply for operator messages to send via appropriate channel (WhatsApp/Instagram/Facebook)
      if (sender === 'operator' && (text || attachments.length > 0)) {
        const message = await this.conversationService.sendReply(
          req.params.conversationId,
          text || (attachments.length > 0 ? '[File attachment]' : ''),
          organizationId.toString(),
          operatorId,
          attachments
        );
        res.json(successResponse(message, 'Message sent'));
      } else {
        // For AI messages or internal notes, just add to DB
        const message = await this.conversationService.addMessage(
          req.params.conversationId,
          {
            ...req.body,
            operatorId,
            attachments
          },
          organizationId.toString()
        );
        res.json(successResponse(message, 'Message added'));
      }
    } catch (error) {
      next(error);
    }
  };

  takeControl = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.takeControl(
        req.params.conversationId,
        req.user._id,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Control taken'));
    } catch (error) {
      next(error);
    }
  };

  releaseControl = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.releaseControl(
        req.params.conversationId,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Control released'));
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.updateStatus(
        req.params.conversationId,
        req.body.status,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Status updated'));
    } catch (error) {
      next(error);
    }
  };

  assignOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.assignOperator(
        req.params.conversationId,
        req.body.operatorId,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Operator assigned'));
    } catch (error) {
      next(error);
    }
  };

  updateLabels = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.updateLabels(
        req.params.conversationId,
        req.body.add,
        req.body.remove,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Labels updated'));
    } catch (error) {
      next(error);
    }
  };

  moveToFolder = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.moveToFolder(
        req.params.conversationId,
        req.body.folderId,
        organizationId.toString()
      );
      res.json(successResponse(conversation, 'Moved to folder'));
    } catch (error) {
      next(error);
    }
  };

  toggleBookmark = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const conversation = await this.conversationService.toggleBookmark(
        req.params.conversationId,
        req.body.isBookmarked ?? true,
        organizationId.toString()
      );
      res.json(successResponse(conversation, conversation.isBookmarked ? 'Bookmarked' : 'Unbookmarked'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const result = await this.conversationService.delete(req.params.conversationId, organizationId.toString());
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  bulkCreate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      const userId = req.user?._id?.toString();
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID or User ID not found');
      }
      const result = await this.conversationService.bulkCreate(
        req.body.conversations, 
        organizationId.toString(),
        userId
      );
      res.json(successResponse(result, 'Conversations created'));
    } catch (error) {
      next(error);
    }
  };

  bulkDelete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.conversationService.bulkDelete(req.body.conversationIds);
      res.json(successResponse(result, 'Conversations deleted'));
    } catch (error) {
      next(error);
    }
  };

  searchMessages = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { query, ...filters } = req.query;
      const results = await this.conversationService.searchMessages(query as string, filters);
      res.json(successResponse({ results, total: results.length }));
    } catch (error) {
      next(error);
    }
  };

  // Save widget conversation (no auth required for public widget)
  // CRITICAL: Requires widgetId in request body
  // Service resolves userId and organizationId internally with strict validation
  // NO FALLBACKS - fails loudly if widgetId invalid or user/org not found
  saveWidgetConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { widgetId, name, threadId, collection, messages } = req.body;

      // CRITICAL: Validate widgetId is present
      if (!widgetId) {
        throw new AppError(400, 'MISSING_WIDGET_ID', 'widgetId is required in request body');
      }

      // Service validates widgetId, resolves userId/organizationId, and ensures tenant isolation
      const conversation = await this.conversationService.saveWidgetConversation({
        widgetId,
        name,
        threadId,
        collection,
        messages
      });

      res.json(successResponse(conversation, 'Conversation saved'));
    } catch (error) {
      next(error);
    }
  };

  fetchTranscript = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { callerId } = req.params;

      const result = await this.conversationService.fetchTranscriptByCallerId(callerId);

      res.json(successResponse(result, 'Transcript fetched successfully'));
    } catch (error) {
      next(error);
    }
  };

  fetchAudio = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { conversationId } = req.params;
      const organizationId = req.user?.organizationId || req.user?._id;

      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const { audioBuffer, contentType } = await this.conversationService.fetchAudioByConversationId(
        conversationId,
        organizationId.toString()
      );

      // Set appropriate headers for audio streaming
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Content-Disposition', `inline; filename="conversation-${conversationId}.mp3"`);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

      // Send the audio buffer
      res.send(audioBuffer);
    } catch (error) {
      next(error);
    }
  };
}

export const conversationController = new ConversationController();
