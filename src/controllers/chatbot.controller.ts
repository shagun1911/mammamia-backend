import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiBehaviorService } from '../services/aiBehavior.service';
import { pythonRagService } from '../services/pythonRag.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';
import KnowledgeBase from '../models/KnowledgeBase';

export class ChatbotController {
  /**
   * POST /chatbot/chat
   * Chat with AI using RAG
   */
  chat = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { query, knowledgeBaseId, threadId } = req.body;

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Get AI behavior configuration
      const aiBehavior = await aiBehaviorService.get(userId);
      
      // Determine collection name
      let collectionName: string | undefined;
      
      if (knowledgeBaseId) {
        // Use specified knowledge base
        const kb = await KnowledgeBase.findById(knowledgeBaseId);
        if (!kb) {
          throw new AppError(404, 'NOT_FOUND', 'Knowledge base not found');
        }
        collectionName = kb.collectionName;
      } else if (aiBehavior.knowledgeBaseId) {
        // Use default knowledge base from AI behavior
        const kb = await KnowledgeBase.findById(aiBehavior.knowledgeBaseId);
        if (kb) {
          collectionName = kb.collectionName;
        }
      }

      // Get system prompt
      const systemPrompt = aiBehavior.chatAgent.systemPrompt || 
        'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';

      // Chat with RAG system
      const response = await pythonRagService.chat({
        query,
        collectionNames: [collectionName || 'default'], // Updated to array for multiple collections support
        threadId,
        systemPrompt
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /chatbot/voice-chat
   * Voice chat with AI using RAG
   */
  voiceChat = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { query, knowledgeBaseId, threadId } = req.body;

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Get AI behavior configuration
      const aiBehavior = await aiBehaviorService.get(userId);
      
      // Determine collection name
      let collectionName: string | undefined;
      
      if (knowledgeBaseId) {
        // Use specified knowledge base
        const kb = await KnowledgeBase.findById(knowledgeBaseId);
        if (!kb) {
          throw new AppError(404, 'NOT_FOUND', 'Knowledge base not found');
        }
        collectionName = kb.collectionName;
      } else if (aiBehavior.knowledgeBaseId) {
        // Use default knowledge base from AI behavior
        const kb = await KnowledgeBase.findById(aiBehavior.knowledgeBaseId);
        if (kb) {
          collectionName = kb.collectionName;
        }
      }

      // Get system prompt for voice
      const systemPrompt = aiBehavior.voiceAgent.systemPrompt || 
        'You are a helpful AI voice assistant. Speak clearly, be empathetic, and provide concise answers.';

      // Chat with RAG system
      const response = await pythonRagService.chat({
        query,
        collectionNames: [collectionName || 'default'], // Updated to array for multiple collections support
        threadId,
        systemPrompt
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };
}

export const chatbotController = new ChatbotController();

