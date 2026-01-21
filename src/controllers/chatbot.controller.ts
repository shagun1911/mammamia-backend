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
      const { 
        query, 
        knowledgeBaseId, 
        threadId,
        elaborate = false,
        skip_history = false
      } = req.body;

      // Log incoming payload for debugging
      console.log('\n========== CHATBOT /chat ENDPOINT - INCOMING REQUEST ==========');
      console.log('[Chatbot] User ID:', userId);
      console.log('[Chatbot] Request Body:', JSON.stringify(req.body, null, 2));
      console.log('[Chatbot] Query:', query);
      console.log('[Chatbot] Knowledge Base ID:', knowledgeBaseId || 'not provided');
      console.log('[Chatbot] Thread ID:', threadId || 'not provided');
      console.log('[Chatbot] Elaborate:', elaborate);
      console.log('[Chatbot] Skip History:', skip_history);
      console.log('===============================================================\n');

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Determine collection names from Settings/AI Behavior
      const collectionNames = await determineCollectionNames(userId, knowledgeBaseId);
      
      console.log('[Chatbot] Resolved Collection Names:', collectionNames);
      if (collectionNames.length === 0) {
        console.warn('[Chatbot] ⚠️  WARNING: No collection names resolved! This will cause "I don\'t have enough information" errors.');
        console.warn('[Chatbot] ⚠️  Please configure a knowledge base in Settings → AI Behavior or Settings → Knowledge Base');
      }

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
        ecommerceCredentials,
        topK: 5, // Default top_k
        elaborate,
        skipHistory: skip_history
      });

      // Log the response to help debug
      console.log('\n========== CHATBOT - RESPONSE FROM PYTHON RAG ==========');
      console.log('[Chatbot] Answer Length:', response.answer?.length || 0);
      console.log('[Chatbot] Answer Preview:', response.answer?.substring(0, 200) || 'NO ANSWER');
      console.log('[Chatbot] Retrieved Docs Count:', response.retrieved_docs?.length || 0);
      console.log('[Chatbot] Context Length:', response.context?.length || 0);
      console.log('[Chatbot] Thread ID:', response.thread_id);
      console.log('========================================================\n');

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
        ecommerceCredentials,
        topK: 5,
        elaborate: false,
        skipHistory: false
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
      // Log full request details for debugging
      console.log('\n========== CHATBOT /widget/:widgetId/chat ENDPOINT - INCOMING REQUEST ==========');
      console.log('[Widget Chat] Full URL:', req.url);
      console.log('[Widget Chat] Original URL:', req.originalUrl);
      console.log('[Widget Chat] Base URL:', req.baseUrl);
      console.log('[Widget Chat] Path:', req.path);
      console.log('[Widget Chat] Params:', JSON.stringify(req.params, null, 2));
      console.log('[Widget Chat] Query:', JSON.stringify(req.query, null, 2));
      
      const { widgetId } = req.params;
      const { query, threadId } = req.body;

      console.log('[Widget Chat] Widget ID from params:', widgetId);
      console.log('[Widget Chat] Request Body:', JSON.stringify(req.body, null, 2));
      console.log('[Widget Chat] Query:', query);
      console.log('[Widget Chat] Thread ID:', threadId || 'not provided');
      console.log('===============================================================================\n');

      if (!query) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Query is required');
      }

      // Validate widgetId
      if (!widgetId) {
        console.error('[Widget Chat] ❌ widgetId is missing from request params');
        console.error('[Widget Chat] This usually means the route parameter is not being captured correctly.');
        console.error('[Widget Chat] Expected URL format: /api/v1/chatbot/widget/{widgetId}/chat');
        throw new AppError(400, 'MISSING_WIDGET_ID', 'Widget ID is required. Please ensure the widget URL includes a valid widget ID.');
      }

      // Get settings by widgetId
      // For now, we'll try to find settings by widgetId if it's a valid ObjectId
      // Otherwise, find the first settings (legacy behavior)
      let settings;
      let userId: string;
      
      console.log('[Widget Chat] Resolving userId from widgetId:', widgetId);
      
      // Try to use widgetId as userId if it's a valid ObjectId format
      if (widgetId && /^[0-9a-fA-F]{24}$/.test(widgetId)) {
        console.log('[Widget Chat] Widget ID looks like ObjectId, trying to use as userId:', widgetId);
        settings = await Settings.findOne({ userId: widgetId });
        if (settings && settings.userId) {
          userId = settings.userId.toString();
          console.log('[Widget Chat] ✅ Found settings for userId:', userId);
        } else {
          console.log('[Widget Chat] No settings found for widgetId as userId:', widgetId);
        }
      } else {
        console.log('[Widget Chat] Widget ID does not match ObjectId format:', widgetId);
      }
      
      // If not found, try to find by widgetId in a future widget mapping table
      // For now, fallback to finding first settings (but log a warning)
      if (!settings) {
        console.warn('[Widget Chat] ⚠️  Could not find settings for widgetId:', widgetId);
        console.warn('[Widget Chat] ⚠️  Falling back to first settings document (this may not be correct)');
        settings = await Settings.findOne().sort({ createdAt: -1 }); // Get most recent
        if (!settings || !settings.userId) {
          throw new AppError(404, 'NOT_FOUND', 'Widget settings not found');
        }
        userId = settings.userId.toString();
        console.warn('[Widget Chat] ⚠️  Using settings for userId:', userId, '(may not match widgetId)');
      } else if (!settings.userId) {
        throw new AppError(404, 'NOT_FOUND', 'Settings found but userId is missing');
      } else {
        userId = settings.userId.toString();
      }

      console.log('[Widget Chat] ✅ Resolved userId:', userId, 'from widgetId:', widgetId);

      // Get organizationId from user for better context resolution
      const User = (await import('../models/User')).default;
      const Organization = (await import('../models/Organization')).default;
      const user = await User.findById(userId);
      let organizationId: string | null = null;

      if (user?.organizationId) {
        organizationId = user.organizationId.toString();
        console.log('[Widget Chat] Found organizationId from user:', organizationId);
      } else {
        // Try to find organization by ownerId
        const organization = await Organization.findOne({ ownerId: userId });
        if (organization) {
          organizationId = organization._id.toString();
          console.log('[Widget Chat] Found organizationId from ownerId:', organizationId);
        } else {
          // Fallback: use userId as organizationId (single-tenant)
          organizationId = userId;
          console.log('[Widget Chat] Using userId as organizationId (single-tenant):', organizationId);
        }
      }

      // Use AIContextService for consistent KB and system prompt resolution
      // Try organization-based resolution first (better for multi-tenant), fallback to user-based
      const { aiContextService } = await import('../services/aiContext.service');
      let aiContext = organizationId 
        ? await aiContextService.resolveFromOrganization(organizationId)
        : null;

      if (!aiContext) {
        console.log('[Widget Chat] Organization-based resolution failed, trying user-based...');
        aiContext = await aiContextService.resolveFromUser(userId);
      }

      if (!aiContext) {
        console.error('[Widget Chat] ❌ No AI context available:', {
          userId,
          organizationId,
          message: 'No knowledge base or settings configured'
        });
        throw new AppError(400, 'NO_KNOWLEDGE_BASE', 'No knowledge base configured. Please configure a knowledge base in Settings → Knowledge Base.');
      }

      const collectionNames = aiContext.collectionNames;
      let systemPrompt = aiContext.systemPrompt;

      console.log('[Widget Chat] ✅ Using AI context:', {
        collectionNames,
        collectionNamesCount: collectionNames.length,
        systemPromptLength: systemPrompt.length,
        userId: aiContext.userId,
        organizationId: aiContext.organizationId,
        autoReplyEnabled: aiContext.autoReplyEnabled
      });

      if (collectionNames.length === 0) {
        console.error('[Widget Chat] ❌ Collection names array is empty!');
        throw new AppError(400, 'NO_KNOWLEDGE_BASE', 'No knowledge base collection names found. Please configure a knowledge base in Settings → Knowledge Base.');
      }

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
        const ApiKeys = (await import('../models/ApiKeys')).default;
        
        console.log('[Widget Chat] Fetching API keys for userId:', userId);
        let apiKeys;
        
        try {
          apiKeys = await apiKeysService.getApiKeys(userId);
        } catch (apiKeysError: any) {
          // If API keys not found for this userId, try to find any API keys as fallback
          // This helps when widgetId resolution picks the wrong user
          console.warn('[Widget Chat] ⚠️  API keys not found for resolved userId, trying to find any API keys...');
          
          const anyApiKeys = await ApiKeys.findOne({ 
            $and: [
              { apiKey: { $exists: true } },
              { apiKey: { $ne: null } },
              { apiKey: { $ne: '' } }
            ]
          }).sort({ updatedAt: -1 });
          
          if (anyApiKeys && anyApiKeys.apiKey && anyApiKeys.apiKey.trim() !== '') {
            console.warn('[Widget Chat] ⚠️  Using API keys from different user:', {
              apiKeysUserId: anyApiKeys.userId.toString(),
              resolvedUserId: userId,
              provider: anyApiKeys.llmProvider
            });
            apiKeys = anyApiKeys;
          } else {
            // Re-throw the original error if no fallback found
            throw apiKeysError;
          }
        }
        
        if (!apiKeys) {
          throw new AppError(404, 'API_KEYS_NOT_CONFIGURED', 'API keys not found. Please configure your API keys in Settings → API Keys.');
        }

        provider = apiKeys.llmProvider;
        apiKey = apiKeys.apiKey;

        if (!apiKey || apiKey.trim() === '') {
          throw new AppError(400, 'API_KEY_EMPTY', 'API key is not set. Please configure your API key in Settings → API Keys.');
        }

        console.log('[Widget Chat] ✅ API keys fetched for LLM generation:', { 
          provider,
          hasApiKey: !!apiKey,
          apiKeyLength: apiKey?.length || 0,
          apiKeysUserId: apiKeys.userId.toString(),
          resolvedUserId: userId
        });
      } catch (error: any) {
        // Log detailed error information
        console.error('[Widget Chat] ❌ Failed to fetch API keys:', {
          userId,
          widgetId,
          errorCode: error.code,
          errorMessage: error.message,
          statusCode: error.statusCode,
          stack: error.stack
        });

        // Re-throw AppError as-is (it already has the correct message)
        if (error instanceof AppError) {
          throw error;
        }

        // For unexpected errors, provide a generic message
        throw new AppError(
          error.statusCode || 500,
          error.code || 'API_KEYS_ERROR',
          error.message || 'Failed to fetch API keys. Please check your API keys configuration in Settings → API Keys.'
        );
      }

      // Chat with RAG system - include provider, apiKey, and ecommerceCredentials (if available)
      // DO NOT fallback to 'default' - use the actual configured knowledge bases
      console.log('[Widget Chat] Calling Python RAG with collectionNames:', collectionNames);
      const response = await pythonRagService.chat({
        query,
        collectionNames: collectionNames, // Use actual configured KBs, no fallback to 'default'
        threadId,
        systemPrompt,
        provider,
        apiKey,
        ecommerceCredentials,
        topK: 5,
        elaborate: false,
        skipHistory: false
      });

      res.json(successResponse(response));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Test chatbot with ecommerce credentials
   * POST /api/v1/chatbot/test
   */
  test = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { 
        query = "I need only products name",
        collection_names = [],
        top_k = 5,
        thread_id,
        system_prompt,
        provider,
        api_key,
        elaborate = false,
        skip_history = false
      } = req.body;

      console.log('\n========== TEST CHATBOT - INCOMING REQUEST ==========');
      console.log('[Test Chatbot] User ID:', userId);
      console.log('[Test Chatbot] Request Body:', JSON.stringify(req.body, null, 2));
      console.log('====================================================\n');

      // Get ecommerce credentials automatically
      const ecommerceCredentials = await getEcommerceCredentials(userId);
      
      if (!ecommerceCredentials) {
        console.log('[Test Chatbot] ⚠️  No e-commerce credentials found');
        return res.status(400).json({
          success: false,
          error: {
            code: 'ECOMMERCE_NOT_CONFIGURED',
            message: 'WooCommerce credentials not found. Please set up WooCommerce integration first.'
          }
        });
      }

      console.log('[Test Chatbot] ✅ E-commerce credentials found:', {
        platform: ecommerceCredentials.platform,
        base_url: ecommerceCredentials.base_url,
        has_api_key: !!ecommerceCredentials.api_key,
        has_api_secret: !!ecommerceCredentials.api_secret
      });

      // Get API keys if not provided
      let finalProvider = provider;
      let finalApiKey = api_key;
      
      if (!finalProvider || !finalApiKey) {
        try {
          const { apiKeysService } = await import('../services/apiKeys.service');
          const apiKeys = await apiKeysService.getApiKeys(userId);
          finalProvider = finalProvider || apiKeys.llmProvider;
          finalApiKey = finalApiKey || apiKeys.apiKey;
          console.log('[Test Chatbot] ✅ API keys fetched:', { provider: finalProvider });
        } catch (error: any) {
          console.error('[Test Chatbot] ⚠️  Failed to fetch API keys:', error.message);
          return res.status(400).json({
            success: false,
            error: {
              code: 'API_KEYS_NOT_CONFIGURED',
              message: 'API keys not configured. Please configure API keys in Settings → API Keys.'
            }
          });
        }
      }

      // Get collection names from settings if not provided
      let finalCollectionNames = collection_names;
      if (finalCollectionNames.length === 0) {
        const collectionNames = await determineCollectionNames(userId);
        finalCollectionNames = collectionNames.length > 0 ? collectionNames : ['default'];
        console.log('[Test Chatbot] Using collection names from settings:', finalCollectionNames);
      }

      // Prepare request body
      const requestBody: any = {
        query,
        collection_name: '',
        collection_names: finalCollectionNames,
        top_k,
        thread_id: thread_id || `test_${Date.now()}`,
        system_prompt: system_prompt || 'You are a helpful assistant from Aistein',
        provider: finalProvider,
        api_key: finalApiKey,
        elaborate,
        skip_history,
        ecommerce_credentials: ecommerceCredentials
      };

      const PYTHON_RAG_BASE_URL = process.env.PYTHON_RAG_BASE_URL || 'https://keplerov1-python-2.onrender.com';
      const testUrl = `${PYTHON_RAG_BASE_URL}/rag/chat`;

      console.log('\n========== TEST CHATBOT - PAYLOAD TO PYTHON ==========');
      console.log('🤖 [Test Chatbot] URL:', testUrl);
      console.log('📦 [Test Chatbot] Request Body:', JSON.stringify({
        ...requestBody,
        ecommerce_credentials: requestBody.ecommerce_credentials ? {
          ...requestBody.ecommerce_credentials,
          api_key: requestBody.ecommerce_credentials.api_key ? `${requestBody.ecommerce_credentials.api_key.substring(0, 10)}...***` : undefined,
          api_secret: '***hidden***'
        } : undefined
      }, null, 2));
      console.log('======================================================\n');

      const axios = require('axios');
      const response = await axios.post(testUrl, requestBody, {
        timeout: 60000
      });

      console.log('\n========== TEST CHATBOT - RESPONSE ==========');
      console.log('✅ [Test Chatbot] Response:', JSON.stringify(response.data, null, 2));
      console.log('============================================\n');

      res.json({
        success: true,
        message: 'Chatbot test completed successfully',
        data: response.data,
        config: {
          query,
          collection_names: finalCollectionNames,
          provider: finalProvider,
          has_ecommerce_credentials: !!ecommerceCredentials,
          ecommerce_platform: ecommerceCredentials.platform
        }
      });
    } catch (error: any) {
      console.error('[Test Chatbot] Error:', error.response?.data || error.message);
      console.error('[Test Chatbot] Error stack:', error.stack);
      next(error);
    }
  };
}

export const chatbotController = new ChatbotController();
