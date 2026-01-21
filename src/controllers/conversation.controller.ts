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
      const { page = 1, limit = 20, ...filters } = req.query;
      
      // CRITICAL: Filter by organization to ensure data isolation
      const orgFilters: any = {
        ...filters
      };
      
      // Only add organizationId filter if it exists (for multi-tenant support)
      if (req.user.organizationId) {
        orgFilters.organizationId = req.user.organizationId.toString();
      }
      
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
      const conversation = await this.conversationService.findById(req.params.conversationId);
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
      
      // Use sendReply for operator messages to send via appropriate channel (WhatsApp/Instagram/Facebook)
      if (sender === 'operator' && (text || attachments.length > 0)) {
        const message = await this.conversationService.sendReply(
          req.params.conversationId,
          text || (attachments.length > 0 ? '[File attachment]' : ''),
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
          }
        );
        res.json(successResponse(message, 'Message added'));
      }
    } catch (error) {
      next(error);
    }
  };

  takeControl = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.takeControl(
        req.params.conversationId,
        req.user._id
      );
      res.json(successResponse(conversation, 'Control taken'));
    } catch (error) {
      next(error);
    }
  };

  releaseControl = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.releaseControl(
        req.params.conversationId
      );
      res.json(successResponse(conversation, 'Control released'));
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.updateStatus(
        req.params.conversationId,
        req.body.status
      );
      res.json(successResponse(conversation, 'Status updated'));
    } catch (error) {
      next(error);
    }
  };

  assignOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.assignOperator(
        req.params.conversationId,
        req.body.operatorId
      );
      res.json(successResponse(conversation, 'Operator assigned'));
    } catch (error) {
      next(error);
    }
  };

  updateLabels = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.updateLabels(
        req.params.conversationId,
        req.body.add,
        req.body.remove
      );
      res.json(successResponse(conversation, 'Labels updated'));
    } catch (error) {
      next(error);
    }
  };

  moveToFolder = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.moveToFolder(
        req.params.conversationId,
        req.body.folderId
      );
      res.json(successResponse(conversation, 'Moved to folder'));
    } catch (error) {
      next(error);
    }
  };

  toggleBookmark = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversation = await this.conversationService.toggleBookmark(
        req.params.conversationId,
        req.body.isBookmarked ?? true
      );
      res.json(successResponse(conversation, conversation.isBookmarked ? 'Bookmarked' : 'Unbookmarked'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.conversationService.delete(req.params.conversationId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  bulkCreate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.conversationService.bulkCreate(req.body.conversations);
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
  saveWidgetConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, threadId, collection, messages } = req.body;
      
      const conversation = await this.conversationService.saveWidgetConversation({
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
}

export const conversationController = new ConversationController();
