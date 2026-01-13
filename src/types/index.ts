import { Document } from 'mongoose';

// Customer Types
export interface ICustomer extends Document {
  userId: string;
  name?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, any>;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Conversation Types
export interface IConversation extends Document {
  userId: string;
  customerId: string;
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  status: 'active' | 'resolved' | 'archived';
  priority: 'low' | 'medium' | 'high';
  assignedTo?: string;
  isAiEnabled: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Message Types
export interface IMessage extends Document {
  conversationId: string;
  senderId: string;
  senderType: 'customer' | 'agent' | 'bot';
  content: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'video';
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Auth Types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
  timestamp: string;
}

