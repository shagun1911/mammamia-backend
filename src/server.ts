// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { initializeSocket } from './config/socket';
import { errorHandler } from './middleware/error.middleware';
import { logger } from './utils/logger.util';
import passport from './config/passport';
import authRoutes from './routes/auth.routes';
import conversationRoutes from './routes/conversation.routes';
import folderRoutes from './routes/folder.routes';
import labelRoutes from './routes/label.routes';
import templateRoutes from './routes/template.routes';
import knowledgeBaseRoutes from './routes/knowledgeBase.routes';
import promptRoutes from './routes/prompt.routes';
import aiBehaviorRoutes from './routes/aiBehavior.routes';
import agentRoutes from './routes/agent.routes';
import emailTemplateRoutes from './routes/emailTemplate.routes';
import chatbotRoutes from './routes/chatbot.routes';
import contactRoutes from './routes/contact.routes';
import campaignRoutes from './routes/campaign.routes';
import automationRoutes from './routes/automation.routes';
import webhookRoutes from './routes/webhook.routes';
import analyticsRoutes from './routes/analytics.routes';
import phoneSettingsRoutes from './routes/phoneSettings.routes';
import toolRoutes from './routes/tool.routes';
import settingsRoutes from './routes/settings.routes';
import apiKeysRoutes from './routes/apiKeys.routes';
import googleIntegrationRoutes from './routes/googleIntegration.routes';
import socialIntegrationRoutes from './routes/socialIntegration.routes';
import metaRoutes from './routes/meta.routes';
import dialog360WebhookRoutes from './routes/webhook.routes';
import profileRoutes from './routes/profile.routes';
import inboundAgentConfigRoutes from './routes/inboundAgentConfig.routes';
import outboundAgentConfigRoutes from './routes/outboundAgentConfig.routes';
import inboundNumbersRoutes from './routes/inboundNumbers.routes'; // Uses new InboundNumber model
import whatsappRoutes from './routes/whatsapp.routes';
import phoneNumberRoutes from './routes/phoneNumber.routes';
import sipTrunkRoutes from './routes/sipTrunk.routes';
import batchCallingRoutes from './routes/batchCalling.routes';
import emailWebhookRoutes from './routes/emailWebhook.routes';

import instagramWebhookRoutes from './routes/instagramWebhook.routes';
import adminRoutes from './routes/admin.routes';
import planRoutes from './routes/plan.routes';
import planWarningsRoutes from './routes/planWarnings.routes';
import ttsRoutes from './routes/tts.routes';


const app = express();
const httpServer = createServer(app);

// Initialize Socket.io
initializeSocket(httpServer);

// Middleware
// CORS configuration - supports multiple origins
const corsOrigin = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'https://keplero-ai-frontend.vercel.app',
      'https://keplero-ai-frontend-git-*.vercel.app' // Support preview deployments
    ];

// CORS configuration - supports multiple origins and file uploads
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
    
    // Check exact match
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check wildcard patterns (for Vercel preview deployments)
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = allowed.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      return callback(null, true);
    }
    
    // In development, allow localhost variations
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Body parsers - but note: multer will handle multipart/form-data
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Initialize Passport
app.use(passport.initialize());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Root endpoint with API information
app.get('/', (req, res) => {
  res.json({
    name: 'AI Chatbot Management Platform API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/v1/health',
      auth: '/api/v1/auth',
      conversations: '/api/v1/conversations',
      contacts: '/api/v1/contacts',
      campaigns: '/api/v1/campaigns',
      automations: '/api/v1/automations',
      analytics: '/api/v1/analytics',
      settings: '/api/v1/settings',
      knowledgeBase: '/api/v1/training/knowledge-bases',
      knowledgeBasesAlias: '/api/v1/knowledge-bases',
      prompts: '/api/v1/training/prompts',
      aiBehavior: '/api/v1/ai-behavior',
      chatbot: '/api/v1/chatbot',
      webhooks: '/api/v1/webhooks',
      phoneSettings: '/api/v1/phone-settings',
      tools: '/api/v1/tools',
      apiKeys: '/api/v1/api-keys',
      profile: '/api/v1/profile'
    },
    documentation: 'Swagger UI not yet implemented - use Postman collection',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Meta Public Routes (no authentication required)
// These routes are required by Meta for compliance (e.g., User Data Deletion)
app.use('/meta', metaRoutes);

// API Routes
app.use('/api/v1/auth', authRoutes);
// Note: Folder and label routes MUST come before conversations route to avoid routing conflicts
app.use('/api/v1/conversations/folders', folderRoutes);
app.use('/api/v1/conversations/labels', labelRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/settings/templates', templateRoutes);
app.use('/api/v1/settings', settingsRoutes); // General settings
app.use('/api/v1/training/knowledge-bases', knowledgeBaseRoutes);
app.use('/api/v1/knowledge-bases', knowledgeBaseRoutes);
app.use('/api/v1/knowledge-base', knowledgeBaseRoutes);
app.use('/api/v1/training/knowledge-base', knowledgeBaseRoutes);
app.use('/api/v1/training/prompts', promptRoutes);
app.use('/api/v1/ai-behavior', aiBehaviorRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/email-templates', emailTemplateRoutes);
app.use('/api/v1/chatbot', chatbotRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/automations', automationRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/webhooks/instagram', instagramWebhookRoutes); // Instagram webhook (separate from OAuth)
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/phone-settings', phoneSettingsRoutes);
app.use('/api/v1/tools', toolRoutes);
app.use('/api/v1/api-keys', apiKeysRoutes);
app.use('/api/v1/integrations', googleIntegrationRoutes);
app.use('/api/v1/social-integrations', socialIntegrationRoutes);
app.use('/api/v1/webhooks/360dialog', dialog360WebhookRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/inbound-agent-config', inboundAgentConfigRoutes);
app.use('/api/v1/outbound-agent-config', outboundAgentConfigRoutes);
app.use('/api/v1/inbound-numbers', inboundNumbersRoutes);
app.use('/api/v1/phone-numbers', phoneNumberRoutes);
app.use('/api/v1/sip-trunk', sipTrunkRoutes);
app.use('/api/v1/batch-calling', batchCallingRoutes);
app.use('/api/v1/webhook', emailWebhookRoutes); // Email webhook for Python API (agent email tool)
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/plans', planRoutes);
app.use('/api/v1/plan-warnings', planWarningsRoutes);
app.use('/api/v1/tts', ttsRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
});

// Error Handler (must be last)
app.use(errorHandler);

// Port configuration - Render uses PORT env variable
const PORT = process.env.PORT;

// Log configuration on startup
console.log('🔧 Server Configuration:');
console.log('   - Environment:', process.env.NODE_ENV || 'development');
console.log('   - Port:', PORT);
console.log('   - CORS Origin:', corsOrigin);
console.log('   - MongoDB:', process.env.MONGODB_URI ? '✓ Configured' : '✗ Missing');
console.log('   - Redis:', process.env.REDIS_URL ? '✓ Configured' : '✗ Missing');

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();
    
    // Connect to Redis
    await connectRedis();

    // Initialize default plans if none exist
    try {
      const { planService } = await import('./services/plan.service');
      await planService.initializeDefaultPlans();
      logger.info('✅ Plans initialized');
    } catch (error: any) {
      logger.warn('⚠️  Could not initialize plans:', error.message);
    }

    // Initialize CSV import queue (will check Redis availability internally)
    try {
      await import('./queues/csvImport.queue');
      // Queue creation happens asynchronously after Redis connection
      logger.info('✅ CSV Import queue module loaded');
    } catch (error: any) {
      logger.warn('⚠️  Could not load CSV import queue:', error.message);
    }

    // Resync all agents with tool_ids to ElevenLabs on startup
    // This ensures tools survive server restarts and are always available
    try {
      const { agentService } = await import('./services/agent.service');
      const Agent = (await import('./models/Agent')).default;
      
      const allAgents = await Agent.find({ 
        tool_ids: { $exists: true }
      }).lean();
      
      const agentsWithTools = allAgents.filter((agent: any) => 
        agent.tool_ids && Array.isArray(agent.tool_ids) && agent.tool_ids.length > 0
      );
      
      if (agentsWithTools.length > 0) {
        logger.info(`[ElevenLabs Sync] Resyncing ${agentsWithTools.length} agents with tools on startup...`);
        
        // Sync all agents in parallel (but with error handling per agent)
        const syncPromises = agentsWithTools.map(async (agent: any) => {
          try {
            await agentService.syncAgentToolsToElevenLabs(agent);
          } catch (error: any) {
            logger.warn(`[ElevenLabs Sync] Failed to sync agent ${agent.agent_id} on startup:`, error.message);
          }
        });
        
        await Promise.allSettled(syncPromises);
        logger.info(`[ElevenLabs Sync] ✅ Startup resync completed for ${agentsWithTools.length} agents`);
      } else {
        logger.info('[ElevenLabs Sync] No agents with tools found, skipping startup resync');
      }
    } catch (error: any) {
      logger.warn('⚠️  Could not perform startup agent sync:', error.message);
      // Don't block server startup if sync fails
    }
    
    // Start server with Socket.io
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Socket.io enabled for real-time messaging`);
      
      // Log webhook endpoints
      const ngrokBaseUrl = process.env.NGROK_BASE_URL;
      const basePath = ngrokBaseUrl ? ngrokBaseUrl : `http://localhost:${PORT}`;
      
      console.log('\n📡 Meta Webhooks active:');
      console.log(`   - WhatsApp: ${basePath}/api/v1/social-integrations/whatsapp/webhook`);
      console.log(`   - Messenger: ${basePath}/api/v1/social-integrations/messenger/webhook`);
      console.log(`   - Instagram: ${basePath}/api/v1/social-integrations/instagram/webhook`);
      
      if (ngrokBaseUrl) {
        console.log(`\n🔗 Using ngrok base URL: ${ngrokBaseUrl}`);
      } else {
        console.log(`\n⚠️  NGROK_BASE_URL not set - using localhost`);
      }
    });
  } catch (error: any) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error('Unhandled Rejection:', err.message);
  process.exit(1);
});

startServer();

