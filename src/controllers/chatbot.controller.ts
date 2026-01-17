import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiBehaviorService } from '../services/aiBehavior.service';
import { pythonRagService } from '../services/pythonRag.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';
import KnowledgeBase from '../models/KnowledgeBase';
import { getEcommerceCredentials } from '../utils/ecommerce.util';

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

      // Get e-commerce credentials if available
      const ecommerceCredentials = await getEcommerceCredentials(userId);

      // Chat with RAG system
      const response = await pythonRagService.chat({
        query,
        collectionNames: [collectionName || 'default'], // Updated to array for multiple collections support
        threadId,
        systemPrompt,
        ecommerceCredentials
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

      // Get e-commerce credentials if available
      const ecommerceCredentials = await getEcommerceCredentials(userId);

      // Chat with RAG system
      const response = await pythonRagService.chat({
        query,
        collectionNames: [collectionName || 'default'], // Updated to array for multiple collections support
        threadId,
        systemPrompt,
        ecommerceCredentials
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Test chatbot query with e-commerce credentials
   * POST /api/v1/chatbot/test
   */
  test = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { 
        query, 
        collection_names, 
        system_prompt, 
        provider, 
        api_key,
        thread_id 
      } = req.body;

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Get e-commerce credentials
      const ecommerceCredentials = await getEcommerceCredentials(userId);

      // Use provided collection_names or get from settings
      let collectionNames: string[] = [];
      if (collection_names && Array.isArray(collection_names) && collection_names.length > 0) {
        collectionNames = collection_names;
      } else {
        // Get from AI behavior or settings
        const aiBehavior = await aiBehaviorService.get(userId);
        const Settings = (await import('../models/Settings')).default;
        const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
        const settings = await Settings.findOne({ userId });

        if (settings?.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
          collectionNames = settings.defaultKnowledgeBaseNames;
        } else if (settings?.defaultKnowledgeBaseIds && settings.defaultKnowledgeBaseIds.length > 0) {
          const kbs = await KnowledgeBase.find({ _id: { $in: settings.defaultKnowledgeBaseIds } });
          collectionNames = kbs.map(kb => kb.collectionName).filter(Boolean);
        } else if (aiBehavior.knowledgeBaseId) {
          const kb = await KnowledgeBase.findById(aiBehavior.knowledgeBaseId);
          if (kb) {
            collectionNames = [kb.collectionName];
          }
        }
      }

      if (collectionNames.length === 0) {
        collectionNames = ['default'];
      }

      // Use provided system_prompt or get from AI behavior
      let systemPrompt = system_prompt;
      if (!systemPrompt) {
        const aiBehavior = await aiBehaviorService.get(userId);
        systemPrompt = aiBehavior.chatAgent.systemPrompt || 
          'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';
      }

      // Prepare request body
      const requestBody: any = {
        query,
        collection_names: collectionNames,
        top_k: 5,
        thread_id: thread_id || `test_${Date.now()}`,
        system_prompt: systemPrompt,
        provider: provider || 'openai',
        api_key: api_key || undefined,
        elaborate: false,
        skip_history: false
      };

      // Add e-commerce credentials if available
      if (ecommerceCredentials) {
        requestBody.ecommerce_credentials = ecommerceCredentials;
        console.log('[Test Chatbot] E-commerce credentials included:', {
          platform: ecommerceCredentials.platform,
          base_url: ecommerceCredentials.base_url
        });
      }

      console.log('\n========== TEST CHATBOT ==========');
      console.log('💬 [Test Chatbot] Request Body:', JSON.stringify({
        ...requestBody,
        api_key: requestBody.api_key ? `${requestBody.api_key.substring(0, 10)}...***` : undefined,
        ecommerce_credentials: requestBody.ecommerce_credentials ? {
          ...requestBody.ecommerce_credentials,
          api_key: requestBody.ecommerce_credentials.api_key ? `${requestBody.ecommerce_credentials.api_key.substring(0, 10)}...***` : undefined,
          api_secret: requestBody.ecommerce_credentials.api_secret ? '***hidden***' : undefined
        } : undefined
      }, null, 2));
      console.log('==================================\n');

      // Call Python RAG service
      const response = await pythonRagService.chat({
        query,
        collectionNames,
        threadId: requestBody.thread_id,
        systemPrompt,
        provider: requestBody.provider,
        apiKey: requestBody.api_key,
        ecommerceCredentials
      });

      console.log('\n========== TEST CHATBOT - RESPONSE ==========');
      console.log('✅ [Test Chatbot] Response:', JSON.stringify(response, null, 2));
      console.log('===========================================\n');

      res.json(successResponse({
        ...response,
        config: {
          collection_names: collectionNames,
          has_ecommerce_credentials: !!ecommerceCredentials,
          provider: requestBody.provider
        }
      }));
    } catch (error) {
      next(error);
    }
  };
}

export const chatbotController = new ChatbotController();

