/**
 * AI Context Service
 * 
 * Provides consistent resolution of Knowledge Base and System Prompt
 * for all AI-powered conversations (chatbot, Messenger, Instagram, WhatsApp)
 * 
 * This ensures that:
 * 1. User's default knowledge bases are used
 * 2. User's custom system prompt from AIBehavior is respected
 * 3. Consistent behavior across all platforms
 */

import mongoose from 'mongoose';

export interface AIContext {
  collectionNames: string[];
  systemPrompt: string;
  userId: string;
  organizationId: string;
  autoReplyEnabled: boolean;
}

export class AIContextService {
  /**
   * Resolve AI context from organizationId
   * This is the main entry point for webhook handlers
   */
  async resolveFromOrganization(organizationId: string): Promise<AIContext | null> {
    try {
      const Organization = (await import('../models/Organization')).default;
      const Settings = (await import('../models/Settings')).default;
      const User = (await import('../models/User')).default;

      // Find organization
      const organization = await Organization.findById(organizationId);
      if (!organization) {
        console.log(`[AI Context] Organization not found: ${organizationId}`);
        
        // Try to resolve directly from userId (single-tenant fallback)
        if (mongoose.Types.ObjectId.isValid(organizationId)) {
          const user = await User.findById(organizationId);
          if (user) {
            console.log(`[AI Context] organizationId is actually a userId, checking user's actual organizationId`);
            
            // CRITICAL: If user has an actual organizationId, use that instead!
            if (user.organizationId && user.organizationId.toString() !== organizationId) {
              console.log(`[AI Context] User has actual organizationId: ${user.organizationId}, resolving from that`);
              return this.resolveFromOrganization(user.organizationId.toString());
            }
            
            // Otherwise, resolve from user directly (single-tenant case)
            console.log(`[AI Context] Resolving from user directly (single-tenant)`);
            return this.resolveFromUser(user._id.toString());
          }
        }
        return null;
      }

      // Priority order for settings resolution:
      // 1. Organization owner (highest priority)
      // 2. Admin users (if role field exists)
      // 3. First user with valid KB settings
      
      let settings = await Settings.findOne({ userId: organization.ownerId });
      let userId = organization.ownerId?.toString();

      // If owner doesn't have settings, try finding admin users first
      if (!settings) {
        const users = await User.find({ organizationId: organizationId }).limit(20);
        
        // First pass: Look for admin users (if role field exists)
        for (const user of users) {
          // Check if user has admin role (common field names: role, isAdmin, userType)
          const isAdmin = (user as any).role === 'admin' || 
                         (user as any).isAdmin === true || 
                         (user as any).userType === 'admin';
          
          if (isAdmin) {
            const userSettings = await Settings.findOne({ userId: user._id });
            if (userSettings && (
              (userSettings.defaultKnowledgeBaseNames && userSettings.defaultKnowledgeBaseNames.length > 0) ||
              userSettings.defaultKnowledgeBaseName ||
              (userSettings.defaultKnowledgeBaseIds && userSettings.defaultKnowledgeBaseIds.length > 0) ||
              userSettings.defaultKnowledgeBaseId
            )) {
              settings = userSettings;
              userId = user._id.toString();
              console.log(`[AI Context] Using admin user's settings: ${userId}`);
              break;
            }
          }
        }
        
        // Second pass: If no admin found, use first user with valid KB settings
        if (!settings) {
          for (const user of users) {
            const userSettings = await Settings.findOne({ userId: user._id });
            if (userSettings && (
              (userSettings.defaultKnowledgeBaseNames && userSettings.defaultKnowledgeBaseNames.length > 0) ||
              userSettings.defaultKnowledgeBaseName ||
              (userSettings.defaultKnowledgeBaseIds && userSettings.defaultKnowledgeBaseIds.length > 0) ||
              userSettings.defaultKnowledgeBaseId
            )) {
              settings = userSettings;
              userId = user._id.toString();
              console.log(`[AI Context] Using first available user's settings: ${userId}`);
              break;
            }
          }
        }
      }

      if (!settings) {
        console.log(`[AI Context] No settings found for organization: ${organizationId}`);
        return null;
      }

      return this.buildContext(settings, userId!, organizationId);
    } catch (error: any) {
      console.error(`[AI Context] Error resolving from organization:`, error.message);
      return null;
    }
  }

  /**
   * Resolve AI context from userId
   * This is used for direct chatbot interactions
   */
  async resolveFromUser(userId: string): Promise<AIContext | null> {
    try {
      const Settings = (await import('../models/Settings')).default;
      const User = (await import('../models/User')).default;

      const settings = await Settings.findOne({ userId });
      if (!settings) {
        console.log(`[AI Context] No settings found for user: ${userId}`);
        return null;
      }

      // Get organization ID from user if available
      const user = await User.findById(userId);
      const organizationId = user?.organizationId?.toString() || userId;

      return this.buildContext(settings, userId, organizationId);
    } catch (error: any) {
      console.error(`[AI Context] Error resolving from user:`, error.message);
      return null;
    }
  }

  /**
   * Resolve AI context from integration document
   * This is used by webhook handlers that have access to the integration
   */
  async resolveFromIntegration(integration: any): Promise<AIContext | null> {
    try {
      const orgId = integration.organizationId || integration.metadata?.organizationId;
      if (!orgId) {
        console.log(`[AI Context] No organizationId in integration`);
        return null;
      }

      return this.resolveFromOrganization(orgId.toString());
    } catch (error: any) {
      console.error(`[AI Context] Error resolving from integration:`, error.message);
      return null;
    }
  }

  /**
   * Resolve KB IDs (kb_, KBDoc_, or legacy ObjectId) to RAG collection names.
   * Chatbot uses ChatbotKnowledgeBase.collection_name; voice agent docs link to ChatbotKB.
   */
  private async resolveIdsToCollectionNames(userId: string, ids: string[]): Promise<string[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
    const KnowledgeBaseDocument = (await import('../models/KnowledgeBaseDocument')).default;
    const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
    const resolvedNames: string[] = [];

    const chatbotKbIds = ids.filter((id: string) => id.startsWith('kb_'));
    const voiceAgentKbIds = ids.filter((id: string) => id.startsWith('KBDoc_'));
    const legacyKbIds = ids.filter((id: string) =>
      !id.startsWith('kb_') && !id.startsWith('KBDoc_') && mongoose.Types.ObjectId.isValid(id)
    );

    // Resolve ChatbotKnowledgeBase IDs
    if (chatbotKbIds.length > 0) {
      const chatbotKBs = await ChatbotKnowledgeBase.find({
        kb_id: { $in: chatbotKbIds },
        userId: userObjectId,
        status: 'ready',
      })
        .select('collection_name')
        .lean();
      resolvedNames.push(...chatbotKBs.map((kb: any) => kb.collection_name).filter(Boolean));
    }

    // Resolve Voice Agent KB IDs (KnowledgeBaseDocument) → linked ChatbotKnowledgeBase
    if (voiceAgentKbIds.length > 0) {
      const voiceAgentKBs = await KnowledgeBaseDocument.find({
        document_id: { $in: voiceAgentKbIds },
        userId: userObjectId,
      })
        .select('linked_chatbot_kb_id')
        .lean();
      const linkedIds = voiceAgentKBs.map((kb: any) => kb.linked_chatbot_kb_id).filter(Boolean);
      if (linkedIds.length > 0) {
        const chatbotKBs = await ChatbotKnowledgeBase.find({
          kb_id: { $in: linkedIds },
          userId: userObjectId,
          status: 'ready',
        })
          .select('collection_name')
          .lean();
        resolvedNames.push(...chatbotKBs.map((kb: any) => kb.collection_name).filter(Boolean));
      }
    }

    // Resolve legacy KnowledgeBase ObjectIds
    if (legacyKbIds.length > 0) {
      const objectIds = legacyKbIds.map((id: string) => new mongoose.Types.ObjectId(id));
      const legacyKBs = await KnowledgeBase.find({ _id: { $in: objectIds } })
        .select('collectionName')
        .lean();
      resolvedNames.push(...legacyKBs.map((kb: any) => kb.collectionName).filter(Boolean));
    }

    return [...new Set(resolvedNames)]; // Deduplicate
  }

  /**
   * Build the AI context object from settings
   */
  private async buildContext(settings: any, userId: string, organizationId: string): Promise<AIContext | null> {
    try {
      // Use Set to merge and deduplicate all KB sources
      const collectionNamesSet = new Set<string>();
      
      // Debug: Log what we have in settings
      console.log(`[AI Context] Building context for user: ${userId}`, {
        defaultKnowledgeBaseNames: settings.defaultKnowledgeBaseNames,
        defaultKnowledgeBaseNamesLength: settings.defaultKnowledgeBaseNames?.length || 0,
        defaultKnowledgeBaseName: settings.defaultKnowledgeBaseName,
        defaultKnowledgeBaseIds: settings.defaultKnowledgeBaseIds,
        defaultKnowledgeBaseIdsLength: settings.defaultKnowledgeBaseIds?.length || 0,
        defaultKnowledgeBaseId: settings.defaultKnowledgeBaseId
      });
      
      // Get user's actual collection names once for validation (used by Priority 1 and 2)
      const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const userChatbotKBs = await ChatbotKnowledgeBase.find({ 
        userId: userObjectId, 
        status: 'ready' 
      }).select('collection_name').lean();
      
      // Create a map of lowercase names to actual names (for case-insensitive matching)
      const userCollectionMap = new Map<string, string>();
      userChatbotKBs.forEach((kb: any) => {
        if (kb.collection_name) {
          userCollectionMap.set(kb.collection_name.toLowerCase(), kb.collection_name);
        }
      });
      
      // Also include legacy KB collections
      const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
      const userLegacyKBs = await KnowledgeBase.find({ userId: userObjectId }).select('collectionName').lean();
      userLegacyKBs.forEach((kb: any) => {
        if (kb.collectionName) {
          userCollectionMap.set(kb.collectionName.toLowerCase(), kb.collectionName);
        }
      });
      
      // Priority 1: Merge defaultKnowledgeBaseNames array (VALIDATE against user's KBs)
      if (settings.defaultKnowledgeBaseNames && Array.isArray(settings.defaultKnowledgeBaseNames) && settings.defaultKnowledgeBaseNames.length > 0) {
        // Only add collection names that actually belong to this user (case-insensitive match)
        settings.defaultKnowledgeBaseNames
          .filter((name: any) => name && typeof name === 'string' && name.trim() !== '')
          .forEach((name: string) => {
            const nameLower = name.trim().toLowerCase();
            const actualName = userCollectionMap.get(nameLower);
            if (actualName) {
              // Use the actual collection name from DB (preserves correct casing)
              collectionNamesSet.add(actualName);
            } else {
              console.warn(`[AI Context] ⚠️  Collection name "${name}" in defaultKnowledgeBaseNames does not belong to user ${userId}, skipping`);
            }
          });
        
        if (collectionNamesSet.size > 0) {
          console.log(`[AI Context] ✅ Merged and validated defaultKnowledgeBaseNames array:`, Array.from(collectionNamesSet));
        } else {
          console.warn(`[AI Context] ⚠️  defaultKnowledgeBaseNames array exists but no valid collections found`);
        }
      }
      
      // Priority 2: Merge defaultKnowledgeBaseName string (single collection name, VALIDATE)
      if (settings.defaultKnowledgeBaseName && typeof settings.defaultKnowledgeBaseName === 'string' && settings.defaultKnowledgeBaseName.trim() !== '') {
        const nameLower = settings.defaultKnowledgeBaseName.trim().toLowerCase();
        const actualName = userCollectionMap.get(nameLower);
        if (actualName) {
          collectionNamesSet.add(actualName);
          console.log(`[AI Context] ✅ Merged and validated defaultKnowledgeBaseName string:`, actualName);
        } else {
          console.warn(`[AI Context] ⚠️  Collection name "${settings.defaultKnowledgeBaseName}" in defaultKnowledgeBaseName does not belong to user ${userId}, skipping`);
        }
      }
      
      // Priority 3: Merge defaultKnowledgeBaseIds array (resolve to collection names)
      // CRITICAL: Support kb_ (ChatbotKnowledgeBase), KBDoc_ (KnowledgeBaseDocument/voice agent), and legacy ObjectId
      if (settings.defaultKnowledgeBaseIds && Array.isArray(settings.defaultKnowledgeBaseIds) && settings.defaultKnowledgeBaseIds.length > 0) {
        const resolvedNames = await this.resolveIdsToCollectionNames(userId, settings.defaultKnowledgeBaseIds);
        resolvedNames.forEach(name => collectionNamesSet.add(name));
        if (resolvedNames.length > 0) {
          console.log(`[AI Context] ✅ Merged resolved defaultKnowledgeBaseIds:`, resolvedNames);
        } else {
          console.warn(`[AI Context] ⚠️  Could not resolve collection names from defaultKnowledgeBaseIds`);
        }
      }
      
      // Priority 4: Merge defaultKnowledgeBaseId (single ID, resolve to collection name)
      if (settings.defaultKnowledgeBaseId) {
        const resolvedNames = await this.resolveIdsToCollectionNames(userId, [settings.defaultKnowledgeBaseId]);
        resolvedNames.forEach(name => collectionNamesSet.add(name));
        if (resolvedNames.length > 0) {
          console.log(`[AI Context] ✅ Merged resolved defaultKnowledgeBaseId:`, resolvedNames);
        } else {
          console.warn(`[AI Context] ⚠️  Knowledge base not found:`, settings.defaultKnowledgeBaseId);
        }
      }

      // Convert Set to array
      let collectionNames = Array.from(collectionNamesSet);

      // Final fallback: If no KB found in Settings, query ChatbotKnowledgeBase for this user (chatbot uses RAG collections)
      if (collectionNames.length === 0) {
        console.warn(`[AI Context] ⚠️  No KB found in Settings, querying ChatbotKnowledgeBase for user: ${userId}`);
        const ChatbotKnowledgeBase = (await import('../models/ChatbotKnowledgeBase')).default;
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const chatbotKBs = await ChatbotKnowledgeBase.find({ userId: userObjectId, status: 'ready' })
          .select('kb_id collection_name')
          .sort({ created_at_unix: -1 })
          .lean();
        
        if (chatbotKBs.length > 0) {
          const fallbackNames = chatbotKBs
            .map((kb: any) => kb.collection_name)
            .filter((name: string) => name && typeof name === 'string' && name.trim() !== '');
          
          // Add to set (merge, not replace)
          fallbackNames.forEach(name => collectionNamesSet.add(name));
          collectionNames = Array.from(collectionNamesSet);
          
          if (collectionNames.length > 0) {
            console.log(`[AI Context] ✅ Found ${collectionNames.length} Chatbot KB(s) for user (fallback):`, collectionNames);
            // Auto-update Settings so next resolve is fast
            try {
              const Settings = (await import('../models/Settings')).default;
              await Settings.updateOne(
                { userId: userObjectId },
                {
                  $set: {
                    defaultKnowledgeBaseNames: collectionNames,
                    defaultKnowledgeBaseIds: chatbotKBs.map((kb: any) => kb.kb_id),
                    defaultKnowledgeBaseName: collectionNames[0],
                    defaultKnowledgeBaseId: chatbotKBs[0].kb_id
                  }
                }
              );
              console.log(`[AI Context] ✅ Auto-updated Settings with Chatbot KBs`);
            } catch (updateError: any) {
              console.warn(`[AI Context] ⚠️  Failed to auto-update Settings:`, updateError.message);
            }
          }
        }
        
        // Legacy fallback: try old KnowledgeBase model
        if (collectionNames.length === 0) {
          const KnowledgeBase = (await import('../models/KnowledgeBase')).default;
          const allKBs = await KnowledgeBase.find({ userId: userObjectId })
            .select('collectionName name isDefault')
            .sort({ isDefault: -1, createdAt: -1 })
            .lean();
          
          if (allKBs.length > 0) {
            const legacyNames = allKBs
              .map((kb: any) => kb.collectionName)
              .filter((name: string) => name && typeof name === 'string' && name.trim() !== '');
            // Add to set (merge, not replace)
            legacyNames.forEach(name => collectionNamesSet.add(name));
            collectionNames = Array.from(collectionNamesSet);
            if (collectionNames.length > 0) {
              console.log(`[AI Context] ✅ Found legacy KB(s) for user:`, collectionNames);
            }
          }
        }
      }

      if (collectionNames.length === 0) {
        console.error(`[AI Context] ❌ No knowledge base configured for user: ${userId}`, {
          hasDefaultNames: !!settings.defaultKnowledgeBaseNames,
          defaultNamesLength: settings.defaultKnowledgeBaseNames?.length || 0,
          defaultNamesValue: settings.defaultKnowledgeBaseNames,
          hasDefaultName: !!settings.defaultKnowledgeBaseName,
          defaultNameValue: settings.defaultKnowledgeBaseName,
          hasDefaultIds: !!settings.defaultKnowledgeBaseIds,
          defaultIdsLength: settings.defaultKnowledgeBaseIds?.length || 0,
          defaultIdsValue: settings.defaultKnowledgeBaseIds,
          hasDefaultId: !!settings.defaultKnowledgeBaseId,
          defaultIdValue: settings.defaultKnowledgeBaseId
        });
        return null;
      }

      // Get system prompt from AIBehavior
      const { aiBehaviorService } = await import('./aiBehavior.service');
      let systemPrompt = 'You are a helpful AI assistant. Provide accurate and concise responses based on the knowledge base.';
      
      try {
        const aiBehavior = await aiBehaviorService.get(userId);
        if (aiBehavior?.chatAgent?.systemPrompt) {
          systemPrompt = aiBehavior.chatAgent.systemPrompt;
          console.log(`[AI Context] Using custom system prompt from AIBehavior for user: ${userId}`);
        }
      } catch (error: any) {
        console.warn(`[AI Context] Could not fetch AIBehavior for user ${userId}, using default prompt:`, error.message);
      }

      // Determine autoReplyEnabled: 
      // 1. If ANY SocialIntegration exists with status="connected", default to true
      // 2. User settings may explicitly disable it (autoReplyEnabled: false), but absence must NOT disable it
      let autoReplyEnabled = true; // Default to true
      
      try {
        const SocialIntegration = (await import('../models/SocialIntegration')).default;
        const hasConnectedIntegration = await SocialIntegration.exists({
          organizationId: organizationId,
          status: 'connected'
        });
        
        if (hasConnectedIntegration) {
          // If connected social integration exists, default to true
          autoReplyEnabled = true;
          console.log(`[AI Context] ✅ Connected social integration found for organization ${organizationId}, autoReplyEnabled defaults to true`);
        } else {
          // No connected integration, but still default to true (absence must NOT disable it)
          autoReplyEnabled = true;
          console.log(`[AI Context] No connected social integration found, autoReplyEnabled defaults to true`);
        }
      } catch (error: any) {
        console.warn(`[AI Context] Could not check SocialIntegration, using default true:`, error.message);
        autoReplyEnabled = true; // Default to true on error
      }
      
      // User settings can explicitly disable autoReplyEnabled
      // Only set to false if explicitly set to false in settings
      if (settings.autoReplyEnabled === false) {
        autoReplyEnabled = false;
        console.log(`[AI Context] ⚠️  autoReplyEnabled explicitly disabled in user settings`);
      }

      console.log(`[AI Context] ✅ Resolved context:`, {
        userId,
        organizationId,
        collectionNames,
        systemPromptLength: systemPrompt.length,
        autoReplyEnabled: autoReplyEnabled
      });

      return {
        collectionNames,
        systemPrompt,
        userId,
        organizationId,
        autoReplyEnabled: autoReplyEnabled
      };
    } catch (error: any) {
      console.error(`[AI Context] Error building context:`, error.message);
      return null;
    }
  }

  /**
   * Generate AI response using the resolved context
   * This is a convenience method that combines context resolution and RAG call
   */
  async generateResponse(params: {
    query: string;
    organizationId?: string;
    userId?: string;
    threadId: string;
  }): Promise<{ answer: string; context: AIContext } | null> {
    try {
      // Resolve context
      let context: AIContext | null = null;
      
      if (params.userId) {
        context = await this.resolveFromUser(params.userId);
      } else if (params.organizationId) {
        context = await this.resolveFromOrganization(params.organizationId);
      }

      if (!context) {
        console.log(`[AI Context] Could not resolve context for response generation`);
        return null;
      }

      // Call Python RAG service
      const { pythonRagService } = await import('./pythonRag.service');
      const ragResponse = await pythonRagService.chat({
        query: params.query,
        collectionNames: context.collectionNames,
        topK: 5,
        threadId: params.threadId,
        systemPrompt: context.systemPrompt
      });

      if (!ragResponse?.answer) {
        console.error(`[AI Context] No response from RAG service`);
        return null;
      }

      return {
        answer: ragResponse.answer,
        context
      };
    } catch (error: any) {
      console.error(`[AI Context] Error generating response:`, error.message);
      return null;
    }
  }
}

export const aiContextService = new AIContextService();

