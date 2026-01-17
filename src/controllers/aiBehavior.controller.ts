import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { aiBehaviorService } from '../services/aiBehavior.service';
import { successResponse } from '../utils/response.util';

export class AIBehaviorController {
  /**
   * GET /ai-behavior
   * Get AI behavior configuration
   */
  get = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const aiBehavior = await aiBehaviorService.get(userId);
      res.json(successResponse(aiBehavior));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/chat-agent/improvements
   * Update chat agent improvements
   */
  updateChatAgentImprovements = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { improvements } = req.body;
      const aiBehavior = await aiBehaviorService.updateChatAgentImprovements(userId, improvements);
      res.json(successResponse(aiBehavior, 'Chat agent improvements updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/chat-agent/prompt
   * Update chat agent system prompt
   */
  updateChatAgentPrompt = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { systemPrompt } = req.body;
      const aiBehavior = await aiBehaviorService.updateChatAgentPrompt(userId, systemPrompt);
      res.json(successResponse(aiBehavior, 'Chat agent prompt updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/chat-agent/human-operator
   * Update chat agent human operator configuration
   */
  updateChatAgentHumanOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { escalationRules, availability } = req.body;
      const aiBehavior = await aiBehaviorService.updateChatAgentHumanOperator(userId, {
        escalationRules,
        availability
      });
      res.json(successResponse(aiBehavior, 'Chat agent human operator configuration updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/voice-agent/improvements
   * Update voice agent improvements
   */
  updateVoiceAgentImprovements = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { improvements } = req.body;
      const aiBehavior = await aiBehaviorService.updateVoiceAgentImprovements(userId, improvements);
      res.json(successResponse(aiBehavior, 'Voice agent improvements updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/voice-agent/prompt
   * Update voice agent system prompt
   */
  updateVoiceAgentPrompt = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { systemPrompt } = req.body;
      const aiBehavior = await aiBehaviorService.updateVoiceAgentPrompt(userId, systemPrompt);
      res.json(successResponse(aiBehavior, 'Voice agent prompt updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/voice-agent/language
   * Update voice agent language
   */
  updateVoiceAgentLanguage = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { language } = req.body;
      const aiBehavior = await aiBehaviorService.updateVoiceAgentLanguage(userId, language);
      res.json(successResponse(aiBehavior, 'Voice agent language updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/voice-agent/human-operator
   * Update voice agent human operator configuration
   */
  updateVoiceAgentHumanOperator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { phoneNumber, escalationRules, availability } = req.body;
      const aiBehavior = await aiBehaviorService.updateVoiceAgentHumanOperator(userId, {
        phoneNumber,
        escalationRules,
        availability
      });
      res.json(successResponse(aiBehavior, 'Voice agent human operator configuration updated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /ai-behavior/knowledge-base
   * Set knowledge base for AI behavior
   */
  setKnowledgeBase = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { knowledgeBaseId } = req.body;
      const aiBehavior = await aiBehaviorService.setKnowledgeBase(userId, knowledgeBaseId);
      res.json(successResponse(aiBehavior, 'Knowledge base linked successfully'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /ai-behavior/voice-agent/test
   * Test voice agent with a phone call
   */
  testVoiceAgent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number is required'
          }
        });
      }

      // Import axios for making HTTP requests
      const axios = (await import('axios')).default;
      
      // Get voice agent settings
      const aiBehavior = await aiBehaviorService.get(userId);
      const voiceAgentPrompt = aiBehavior.voiceAgent.systemPrompt || 'You are a helpful AI voice assistant.';
      const voiceLanguage = aiBehavior.voiceAgent.language || 'en';
      const escalationRules = aiBehavior.voiceAgent.humanOperator?.escalationRules || [];
      const escalationCondition = escalationRules.length > 0 ? escalationRules.join('. ') : '';

      // Get phone settings
      const { phoneSettingsService } = await import('../services/phoneSettings.service');
      const phoneSettings = await phoneSettingsService.get(userId);
      
      if (!phoneSettings || !phoneSettings.isConfigured) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PHONE_NOT_CONFIGURED',
            message: 'Phone settings not configured. Please configure in Settings → Channels → Phone.'
          }
        });
      }

      // Get API keys
      const { apiKeysService } = await import('../services/apiKeys.service');
      const apiKeys = await apiKeysService.getApiKeys(userId);

      // Map selectedVoice name to ElevenLabs voice ID
      const VOICE_ID_MAP: Record<string, string> = {
        'domenico': 'QABTI1ryPrQsJUflbKB7',
        'thomas': 'CITWdMEsnRduEUkNWXQv',
        'mario': 'irAl0cku0Hx4TEUJ8d1Q',
        'gianp': 'SpoXt7BywHwFLisCTpQ3',
        'vittorio': 'nH7uLS5UdEnvKEOAXtlQ',
        'ginevra': 'QITiGyM4owEZrBEf0QV8',
        'roberta': 'ZzFXkjuO1rPntDj6At5C',
        'giusy': '8KInRSd4DtD5L5gK7itu',
        'roxy': 'mGiFn5Udfw93ewbgFHaP',
        'sami': 'kAzI34nYjizE0zON6rXv',
        'alejandro': 'YKUjKbMlejgvkOZlnnvt',
        'antonio': 'htFfPSZGJwjBv1CL0aMD',
        'el_faraon': '8mBRP99B2Ng2QwsJMFQl',
        'lumina': 'x5IDPSl4ZUbhosMmVFTk',
        'elena': 'tXgbXPnsMpKXkuTgvE3h',
        'sara': 'gD1IexrzCvsXPHUuT0s3',
        'zara': 'jqcCZkN6Knx8BJ5TBdYR',
        'brittney': 'kPzsL2i3teMYv0FxEYQ6',
        'julieanne': '8WaMCGQzWsKvf7sGPqjE',
        'allison': 'xctasy8XvGp2cVO9HL9k',
        'jameson': 'Mu5jxyqZOLIGltFpfalg',
        'mark': 'UgBBYS2sOqTuMpoF3BR0',
        'archie': 'kmSVBPu7loj4ayNinwWM',
        'adam': 'pNInz6obpgDQGcFmaJgB', // fallback
      };
      
      // Use customVoiceId if provided, otherwise use the mapped voice ID
      const voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
      
      console.log('📢 [AI Behavior Test] Voice Mapping:', {
        selectedVoice: phoneSettings.selectedVoice,
        customVoiceId: phoneSettings.customVoiceId,
        mappedVoiceId: voiceId
      });
      
      // Normalize phone number
      const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;

      // Get knowledge bases - check multiple sources with fallbacks
      let collectionNames: string[] = [];
      try {
        const Settings = (await import('../models/Settings')).default;
        const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
        const settings = await Settings.findOne({ userId: req.user!.id });
        
        if (settings) {
          // Priority 1: Use collection names from Settings (new format - multiple KBs)
          if (settings.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
            collectionNames = settings.defaultKnowledgeBaseNames;
            console.log(`[Test Call] Using knowledge bases from Settings.defaultKnowledgeBaseNames:`, collectionNames);
          }
          // Priority 2: Resolve knowledge base IDs from Settings to collection names
          else if (settings.defaultKnowledgeBaseIds && settings.defaultKnowledgeBaseIds.length > 0) {
            const knowledgeBases = await KnowledgeBase.find({ 
              _id: { $in: settings.defaultKnowledgeBaseIds } 
            }).select('collectionName').lean();
            collectionNames = knowledgeBases.map((kb: any) => kb.collectionName).filter(Boolean);
            console.log(`[Test Call] Resolved knowledge base IDs to collection names:`, collectionNames);
          }
          // Priority 3: Use single knowledge base name from Settings (legacy format)
          else if (settings.defaultKnowledgeBaseName) {
            collectionNames = [settings.defaultKnowledgeBaseName];
            console.log(`[Test Call] Using knowledge base from Settings.defaultKnowledgeBaseName:`, collectionNames);
          }
          // Priority 4: Resolve single knowledge base ID from Settings (legacy format)
          else if (settings.defaultKnowledgeBaseId) {
            const kb = await KnowledgeBase.findById(settings.defaultKnowledgeBaseId).select('collectionName').lean();
            if (kb && kb.collectionName) {
              collectionNames = [kb.collectionName];
              console.log(`[Test Call] Resolved knowledge base ID from Settings:`, collectionNames);
            }
          }
        }
        
        // Priority 5: Use knowledge base from AI Behavior (if settings didn't have one)
        if (collectionNames.length === 0 && aiBehavior.knowledgeBaseId) {
          const kb = await KnowledgeBase.findById(aiBehavior.knowledgeBaseId).select('collectionName').lean();
          if (kb && kb.collectionName) {
            collectionNames = [kb.collectionName];
            console.log(`[Test Call] Using knowledge base from AI Behavior:`, collectionNames);
          }
        }
        
        // Final fallback: use 'default' if nothing found
        if (collectionNames.length === 0) {
          collectionNames = ['default'];
          console.warn(`[Test Call] No knowledge base configured - using 'default' collection`);
        } else {
          console.log(`[Test Call] Using ${collectionNames.length} knowledge base(s):`, collectionNames);
        }
      } catch (error: any) {
        console.error(`[Test Call] Error fetching knowledge bases:`, error.message);
        collectionNames = ['default']; // Fallback on error
      }

      // Get e-commerce credentials if available
      const { getEcommerceCredentials } = await import('../utils/ecommerce.util');
      const ecommerceCredentials = await getEcommerceCredentials(req.user!.id);

      // Prepare call request
      const COMM_API = process.env.COMM_API_URL || 'https://keplerov1-python-2.onrender.com';
      const callRequestBody: any = {
        phone_number: normalizedPhone,
        name: 'Test User',
        dynamic_instruction: voiceAgentPrompt,
        language: voiceLanguage,
        voice_id: voiceId,
        sip_trunk_id: phoneSettings.livekitSipTrunkId,
        provider: apiKeys.llmProvider,
        api_key: apiKeys.apiKey,
        collection_names: collectionNames, // Updated to support multiple collections
        greeting_message: phoneSettings.greetingMessage || 'Hello! How can I help you today?' // Greeting message from settings
      };

      // Add e-commerce credentials if available
      if (ecommerceCredentials) {
        callRequestBody.ecommerce_credentials = ecommerceCredentials;
      }
      
      console.log('📝 [Test Call] Call Configuration:');
      console.log('   - Greeting:', callRequestBody.greeting_message);
      console.log('   - Knowledge Bases (collection_names):', JSON.stringify(callRequestBody.collection_names));
      console.log('   - Collection Count:', callRequestBody.collection_names.length);

      // Add transfer_to and escalation_condition from settings
      if (phoneSettings.humanOperatorPhone) {
        callRequestBody.transfer_to = phoneSettings.humanOperatorPhone;
      }
      if (escalationCondition) {
        callRequestBody.escalation_condition = escalationCondition;
      }

      const callUrl = `${COMM_API}/calls/outbound`;
      
      console.log('\n========== TEST VOICE AGENT - OUTBOUND CALL ==========');
      console.log('📞 [AI Behavior Test] URL:', callUrl);
      console.log('📦 [AI Behavior Test] Request Summary:');
      console.log('   - Phone:', normalizedPhone);
      console.log('   - Collection Names:', JSON.stringify(callRequestBody.collection_names));
      console.log('   - Collection Count:', callRequestBody.collection_names.length);
      console.log('   - Greeting:', callRequestBody.greeting_message);
      console.log('   - Provider:', callRequestBody.provider);
      console.log('   - API Key:', callRequestBody.api_key ? '✅ Set' : '❌ Missing');
      console.log('📦 [AI Behavior Test] Full Request Body:', JSON.stringify({
        ...callRequestBody,
        api_key: callRequestBody.api_key ? `${callRequestBody.api_key.substring(0, 10)}...***` : 'NOT_SET'
      }, null, 2));
      console.log('=====================================================\n');

      // Make the call
      const callResponse = await axios.post(callUrl, callRequestBody, {
        timeout: 360000, // 6 minutes
      });

      console.log('\n========== TEST VOICE AGENT - CALL RESPONSE ==========');
      console.log('✅ [AI Behavior Test] Response Status:', callResponse.status);
      console.log('📦 [AI Behavior Test] Full Response Body:', JSON.stringify(callResponse.data, null, 2));
      console.log('=====================================================\n');

      // Create conversation immediately after successful call
      let conversationId = null;
      if (callResponse.data.status === 'success' && callResponse.data.details?.caller_id) {
        try {
          const { conversationService } = await import('../services/conversation.service');
          
          // Get organizationId - fallback to userId if not set
          const organizationId = req.user!.organizationId 
            ? (typeof req.user!.organizationId === 'string' 
                ? req.user!.organizationId 
                : req.user!.organizationId.toString())
            : req.user!.id;
          
          console.log(`[Test Call] Creating conversation with organizationId: ${organizationId}`);
          
          const conversation = await conversationService.createForOutboundCall({
            userId: req.user!.id,
            organizationId: organizationId,
            phone: normalizedPhone,
            name: 'Test User',
            callerId: callResponse.data.details.caller_id
          });
          conversationId = conversation._id;
          console.log(`[Test Call] ✅ Created conversation: ${conversationId}`);
        } catch (convError: any) {
          console.error(`[Test Call] ❌ Failed to create conversation:`, convError.message);
          console.error(`[Test Call] Error stack:`, convError.stack);
        }
      }

      return res.json({
        success: true,
        data: {
          status: callResponse.data.status || 'initiated',
          message: callResponse.data.message || 'Test call initiated successfully',
          phoneNumber: normalizedPhone,
          details: callResponse.data.details,
          transcript: callResponse.data.transcript,
          conversationId
        },
        message: 'Test call initiated successfully. Check Conversations to view transcript when call ends.'
      });
    } catch (error: any) {
      console.error('[AI Behavior] Test voice agent error:', error);
      
      // Return JSON error response instead of HTML
      const errorMessage = error.response?.data?.detail 
        || error.response?.data?.message 
        || error.message 
        || 'Failed to initiate test call';
      
      return res.status(error.response?.status || 500).json({
        success: false,
        error: {
          code: 'TEST_CALL_FAILED',
          message: errorMessage
        }
      });
    }
  };
}

export const aiBehaviorController = new AIBehaviorController();

