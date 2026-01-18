import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiBehaviorService } from '../services/aiBehavior.service';
import { pythonRagService } from '../services/pythonRag.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';
import KnowledgeBase from '../models/KnowledgeBase';
import { getEcommerceCredentials } from '../utils/ecommerce.util';
import Settings from '../models/Settings';

// Helper function to determine collection names from Settings/AI Behavior
async function determineCollectionNames(userId: string, knowledgeBaseId?: string): Promise<string[]> {
  let collectionNames: string[] = [];
  
  if (knowledgeBaseId) {
    // Use specified knowledge base
    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      throw new AppError(404, 'NOT_FOUND', 'Knowledge base not found');
    }
    collectionNames = [kb.collectionName];
  } else {
    // Check Settings first (priority order like other controllers)
    const settings = await Settings.findOne({ userId });
    
    if (settings) {
      // Priority 1: Use collection names from Settings (new format - multiple KBs)
      if (settings.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
        collectionNames = settings.defaultKnowledgeBaseNames;
        console.log('[Chatbot] Using knowledge bases from Settings.defaultKnowledgeBaseNames:', collectionNames);
      }
      // Priority 2: Resolve knowledge base IDs from Settings to collection names
      else if (settings.defaultKnowledgeBaseIds && settings.defaultKnowledgeBaseIds.length > 0) {
        const knowledgeBases = await KnowledgeBase.find({ 
          _id: { $in: settings.defaultKnowledgeBaseIds } 
        }).select('collectionName').lean();
        collectionNames = knowledgeBases.map((kb: any) => kb.collectionName).filter(Boolean);
        console.log('[Chatbot] Resolved knowledge base IDs to collection names:', collectionNames);
      }
      // Priority 3: Use single knowledge base name from Settings (legacy format)
      else if (settings.defaultKnowledgeBaseName) {
        collectionNames = [settings.defaultKnowledgeBaseName];
        console.log('[Chatbot] Using knowledge base from Settings.defaultKnowledgeBaseName:', collectionNames);
      }
      // Priority 4: Resolve single knowledge base ID from Settings (legacy format)
      else if (settings.defaultKnowledgeBaseId) {
        const kb = await KnowledgeBase.findById(settings.defaultKnowledgeBaseId).select('collectionName').lean();
        if (kb && kb.collectionName) {
          collectionNames = [kb.collectionName];
          console.log('[Chatbot] Resolved knowledge base ID from Settings:', collectionNames);
        }
      }
    }
    
    // Priority 5: Use knowledge base from AI Behavior (if settings didn't have one)
    if (collectionNames.length === 0) {
      const aiBehavior = await aiBehaviorService.get(userId);
      if (aiBehavior.knowledgeBaseId) {
        const kb = await KnowledgeBase.findById(aiBehavior.knowledgeBaseId);
        if (kb) {
          collectionNames = [kb.collectionName];
          console.log('[Chatbot] Using knowledge base from AI Behavior:', collectionNames);
        }
      }
    }
    
    // Final fallback: use 'default' if nothing found
    if (collectionNames.length === 0) {
      collectionNames = ['default'];
      console.log('[Chatbot] No knowledge base configured - using default collection');
    }
  }
  
  return collectionNames;
}

export class ChatbotController {
  /**
   * POST /chatbot/chat
   * Chat with AI using RAG
   */
  chat = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { query, knowledgeBaseId, threadId } = req.body;

      // Log incoming payload for debugging
      console.log('\n========== CHATBOT /chat ENDPOINT - INCOMING REQUEST ==========');
      console.log('[Chatbot] User ID:', userId);
      console.log('[Chatbot] Request Body:', JSON.stringify(req.body, null, 2));
      console.log('[Chatbot] Query:', query);
      console.log('[Chatbot] Knowledge Base ID:', knowledgeBaseId || 'not provided');
      console.log('[Chatbot] Thread ID:', threadId || 'not provided');
      console.log('===============================================================\n');

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Determine collection names from Settings/AI Behavior
      const collectionNames = await determineCollectionNames(userId, knowledgeBaseId);

      // Get AI behavior configuration
      const aiBehavior = await aiBehaviorService.get(userId);

      // Get system prompt
      let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
        'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';

      // Get WooCommerce credentials if available (OPTIONAL)
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      // Log e-commerce credentials status for debugging
      if (ecommerceCredentials) {
        console.log('[Chatbot] ✅ E-commerce credentials found:', {
          platform: ecommerceCredentials.platform,
          base_url: ecommerceCredentials.base_url,
          has_api_key: !!ecommerceCredentials.api_key,
          has_api_secret: !!ecommerceCredentials.api_secret
        });
      } else {
        console.log('[Chatbot] ⚠️  No e-commerce credentials found for user:', userId);
        console.log('[Chatbot] ⚠️  WooCommerce queries will not work. Configure in Settings → Integrations → WooCommerce');
      }
      
      // Append enhanced instructions to system prompt (SAFE - only appends, doesn't replace)
      systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
      systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
      systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
      systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
      systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
      
      if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
        systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
        systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
        systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
        console.log('[Chatbot] ✅ WooCommerce credentials found - enhanced system prompt with KB-first and WooCommerce instructions');
      } else {
        systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
        console.log('[Chatbot] Enhanced system prompt with KB-first instructions');
      }

      // Get API keys for LLM generation (REQUIRED for Python backend to generate answers)
      let provider: string | undefined;
      let apiKey: string | undefined;
      try {
        const { apiKeysService } = await import('../services/apiKeys.service');
        const apiKeys = await apiKeysService.getApiKeys(userId);
        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;
        console.log('[Chatbot] ✅ API keys fetched for LLM generation:', { provider });
      } catch (error: any) {
        console.warn('[Chatbot] ⚠️  Failed to fetch API keys:', error.message);
        console.warn('[Chatbot] ⚠️  LLM generation will fail without API keys. Please configure API keys in Settings → API Keys.');
      }

      // Log what we're sending to Python RAG service
      console.log('\n========== CHATBOT - PAYLOAD TO PYTHON RAG ==========');
      console.log('[Chatbot] Query:', query);
      console.log('[Chatbot] Collection Names:', collectionNames.length > 0 ? collectionNames : ['default']);
      console.log('[Chatbot] Provider:', provider);
      console.log('[Chatbot] Has API Key:', !!apiKey);
      console.log('[Chatbot] Has E-commerce Credentials:', !!ecommerceCredentials);
      if (ecommerceCredentials) {
        console.log('[Chatbot] E-commerce Platform:', ecommerceCredentials.platform);
        console.log('[Chatbot] E-commerce Base URL:', ecommerceCredentials.base_url);
        console.log('[Chatbot] E-commerce Has API Key:', !!ecommerceCredentials.api_key);
        console.log('[Chatbot] E-commerce Has API Secret:', !!ecommerceCredentials.api_secret);
      } else {
        console.log('[Chatbot] ⚠️  E-commerce credentials are NULL/UNDEFINED - will NOT be sent to Python backend');
      }
      console.log('=====================================================\n');

      // Chat with RAG system - include provider, apiKey, and ecommerceCredentials (if available)
      const response = await pythonRagService.chat({
        query,
        collectionNames: collectionNames.length > 0 ? collectionNames : ['default'],
        threadId,
        systemPrompt,
        provider,
        apiKey,
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

      // Determine collection names from Settings/AI Behavior
      const collectionNames = await determineCollectionNames(userId, knowledgeBaseId);

      // Get AI behavior configuration
      const aiBehavior = await aiBehaviorService.get(userId);

      // Get system prompt for voice
      let systemPrompt = aiBehavior.voiceAgent.systemPrompt || 
        'You are a helpful AI voice assistant. Speak clearly, be empathetic, and provide concise answers.';

      // Get WooCommerce credentials if available (OPTIONAL)
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      // Log e-commerce credentials status for debugging
      if (ecommerceCredentials) {
        console.log('[Chatbot Voice] ✅ E-commerce credentials found:', {
          platform: ecommerceCredentials.platform,
          base_url: ecommerceCredentials.base_url,
          has_api_key: !!ecommerceCredentials.api_key,
          has_api_secret: !!ecommerceCredentials.api_secret
        });
      } else {
        console.log('[Chatbot Voice] ⚠️  No e-commerce credentials found for user:', userId);
        console.log('[Chatbot Voice] ⚠️  WooCommerce queries will not work. Configure in Settings → Integrations → WooCommerce');
      }
      
      // Append enhanced instructions to system prompt (SAFE - only appends, doesn't replace)
      systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
      systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
      systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
      systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
      systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
      
      if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
        systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
        systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
        systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
        console.log('[Chatbot Voice] ✅ WooCommerce credentials found - enhanced system prompt with KB-first and WooCommerce instructions');
      } else {
        systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
        console.log('[Chatbot Voice] Enhanced system prompt with KB-first instructions');
      }

      // Get API keys for LLM generation (REQUIRED for Python backend to generate answers)
      let provider: string | undefined;
      let apiKey: string | undefined;
      try {
        const { apiKeysService } = await import('../services/apiKeys.service');
        const apiKeys = await apiKeysService.getApiKeys(userId);
        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;
        console.log('[Chatbot Voice] ✅ API keys fetched for LLM generation:', { provider });
      } catch (error: any) {
        console.warn('[Chatbot Voice] ⚠️  Failed to fetch API keys:', error.message);
        console.warn('[Chatbot Voice] ⚠️  LLM generation will fail without API keys. Please configure API keys in Settings → API Keys.');
      }

      // Chat with RAG system - include provider, apiKey, and ecommerceCredentials (if available)
      const response = await pythonRagService.chat({
        query,
        collectionNames: collectionNames.length > 0 ? collectionNames : ['default'],
        threadId,
        systemPrompt,
        provider,
        apiKey,
        ecommerceCredentials
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /chatbot/widget/:widgetId/chat
   * Public widget chat endpoint (no auth required)
   * Uses widgetId to find user settings and API keys
   */
  widgetChat = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { widgetId } = req.params;
      const { query, threadId } = req.body;

      // Log incoming payload for debugging
      console.log('\n========== CHATBOT /widget/:widgetId/chat ENDPOINT - INCOMING REQUEST ==========');
      console.log('[Widget Chat] Widget ID:', widgetId);
      console.log('[Widget Chat] Request Body:', JSON.stringify(req.body, null, 2));
      console.log('[Widget Chat] Query:', query);
      console.log('[Widget Chat] Thread ID:', threadId || 'not provided');
      console.log('===============================================================================\n');

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Get settings by widgetId (finds first settings for now, can be enhanced to map widgetId to user)
      const settings = await Settings.findOne();
      if (!settings || !settings.userId) {
        throw new AppError(404, 'NOT_FOUND', 'Widget settings not found');
      }

      const userId = settings.userId.toString();

      // Determine collection names from Settings/AI Behavior
      const collectionNames = await determineCollectionNames(userId);

      // Get AI behavior configuration
      const aiBehavior = await aiBehaviorService.get(userId);

      // Get system prompt
      let systemPrompt = aiBehavior.chatAgent.systemPrompt || 
        'You are a helpful AI assistant designed to provide excellent customer service. Be friendly, professional, and helpful.';

      // Get WooCommerce credentials if available (OPTIONAL)
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      // Log e-commerce credentials status for debugging
      if (ecommerceCredentials) {
        console.log('[Widget Chat] ✅ E-commerce credentials found:', {
          platform: ecommerceCredentials.platform,
          base_url: ecommerceCredentials.base_url,
          has_api_key: !!ecommerceCredentials.api_key,
          has_api_secret: !!ecommerceCredentials.api_secret
        });
      } else {
        console.log('[Widget Chat] ⚠️  No e-commerce credentials found for user:', userId);
        console.log('[Widget Chat] ⚠️  WooCommerce queries will not work. Configure in Settings → Integrations → WooCommerce');
      }
      
      // Append enhanced instructions to system prompt (SAFE - only appends, doesn't replace)
      systemPrompt += '\n\nIMPORTANT INSTRUCTIONS:\n';
      systemPrompt += '1. Always use the knowledge base (retrieved documents) as the PRIMARY source for answering questions.\n';
      systemPrompt += '2. Generate concise, natural language answers (4-6 sentences max) from the retrieved documents.\n';
      systemPrompt += '3. Do NOT include document labels, metadata, or raw text dumps in your answer.\n';
      systemPrompt += '4. Summarize and merge relevant information into a clean, readable response.\n';
      
      if (ecommerceCredentials && ecommerceCredentials.platform === 'woocommerce') {
        systemPrompt += '\n5. For product-related queries (e.g., "list products", "woocommerce products", "show products", "product price", "inventory"), use the provided WooCommerce credentials to fetch real-time data from the store.\n';
        systemPrompt += '6. For all other questions, use the knowledge base as the primary source.\n';
        systemPrompt += '7. If WooCommerce is not connected or credentials are invalid, politely inform the user: "The store is not connected yet. Please contact support to set up the store integration."\n';
        console.log('[Widget Chat] ✅ WooCommerce credentials found - enhanced system prompt with KB-first and WooCommerce instructions');
      } else {
        systemPrompt += '\n5. Focus on providing accurate answers from the knowledge base.\n';
        console.log('[Widget Chat] Enhanced system prompt with KB-first instructions');
      }

      // Get API keys for LLM generation (REQUIRED for Python backend to generate answers)
      let provider: string | undefined;
      let apiKey: string | undefined;
      try {
        const { apiKeysService } = await import('../services/apiKeys.service');
        const apiKeys = await apiKeysService.getApiKeys(userId);
        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;
        console.log('[Widget Chat] ✅ API keys fetched for LLM generation:', { provider });
      } catch (error: any) {
        console.warn('[Widget Chat] ⚠️  Failed to fetch API keys:', error.message);
        throw new AppError(500, 'API_KEYS_NOT_CONFIGURED', 'API keys not configured. Please configure API keys in Settings → API Keys.');
      }

      // Chat with RAG system - include provider, apiKey, and ecommerceCredentials (if available)
      const response = await pythonRagService.chat({
        query,
        collectionNames: collectionNames.length > 0 ? collectionNames : ['default'],
        threadId,
        systemPrompt,
        provider,
        apiKey,
        ecommerceCredentials
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };
}

export const chatbotController = new ChatbotController();
