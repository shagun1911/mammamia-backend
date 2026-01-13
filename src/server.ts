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
import dialog360WebhookRoutes from './routes/webhook.routes';
import profileRoutes from './routes/profile.routes';
import inboundAgentConfigRoutes from './routes/inboundAgentConfig.routes';

const app = express();
const httpServer = createServer(app);

// Initialize Socket.io
initializeSocket(httpServer);

// Middleware
// CORS configuration - supports multiple origins
const corsOrigin = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : 'http://localhost:3000';

app.use(cors({ 
  origin: corsOrigin,
  credentials: true 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API Routes
app.use('/api/v1/auth', authRoutes);
// Note: Folder and label routes MUST come before conversations route to avoid routing conflicts
app.use('/api/v1/conversations/folders', folderRoutes);
app.use('/api/v1/conversations/labels', labelRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/settings/templates', templateRoutes);
app.use('/api/v1/settings', settingsRoutes); // General settings
app.use('/api/v1/training/knowledge-bases', knowledgeBaseRoutes);
app.use('/api/v1/knowledge-bases', knowledgeBaseRoutes); // Alias for easier access
app.use('/api/v1/training/prompts', promptRoutes);
app.use('/api/v1/ai-behavior', aiBehaviorRoutes);
app.use('/api/v1/chatbot', chatbotRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/automations', automationRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/phone-settings', phoneSettingsRoutes);
app.use('/api/v1/tools', toolRoutes);
app.use('/api/v1/api-keys', apiKeysRoutes);
app.use('/api/v1/integrations', googleIntegrationRoutes);
app.use('/api/v1/social-integrations', socialIntegrationRoutes);
app.use('/api/v1/webhooks/360dialog', dialog360WebhookRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/inbound-agent-config', inboundAgentConfigRoutes);

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
const PORT = process.env.PORT || 5001;

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
    
    // Start server with Socket.io
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Socket.io enabled for real-time messaging`);
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

