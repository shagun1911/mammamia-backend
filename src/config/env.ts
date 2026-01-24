export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb+srv://LOVJEET:LOVJEETMONGO@cluster0.zpzj90m.mongodb.net/Aistein.It'
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000'
  },
  platform: {
    // Platform API keys - used for all users
    openaiApiKey: process.env.PLATFORM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.PLATFORM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    defaultProvider: (process.env.PLATFORM_DEFAULT_LLM_PROVIDER || 'openai') as 'openai' | 'gemini'
  }
};

