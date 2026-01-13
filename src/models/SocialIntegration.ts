import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!'; // Must be 32 chars
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

export interface ISocialIntegration extends Document {
  organizationId: mongoose.Types.ObjectId;
  platform: 'whatsapp' | 'instagram' | 'facebook';
  status: 'connected' | 'disconnected' | 'error';
  credentials: {
    apiKey: string; // Encrypted
    clientId?: string;
    phoneNumberId?: string; // For WhatsApp
    wabaId?: string; // WhatsApp Business Account ID
    instagramAccountId?: string; // For Instagram
    facebookPageId?: string; // For Facebook
  };
  webhookVerified: boolean;
  lastSyncedAt?: Date;
  errorMessage?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SocialIntegrationSchema = new Schema<ISocialIntegration>({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  platform: {
    type: String,
    enum: ['whatsapp', 'instagram', 'facebook'],
    required: true
  },
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'disconnected'
  },
  credentials: {
    apiKey: { type: String, required: true },
    clientId: String,
    phoneNumberId: String,
    wabaId: String,
    instagramAccountId: String,
    facebookPageId: String
  },
  webhookVerified: {
    type: Boolean,
    default: false
  },
  lastSyncedAt: Date,
  errorMessage: String,
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Compound index to ensure one integration per platform per organization
SocialIntegrationSchema.index({ organizationId: 1, platform: 1 }, { unique: true });

// Encrypt API key before saving
SocialIntegrationSchema.pre('save', function(next) {
  if (this.isModified('credentials.apiKey')) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        ENCRYPTION_ALGORITHM,
        Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
        iv
      );
      let encrypted = cipher.update(this.credentials.apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      this.credentials.apiKey = iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
    }
  }
  next();
});

// Method to decrypt API key
SocialIntegrationSchema.methods.getDecryptedApiKey = function(): string {
  try {
    const parts = this.credentials.apiKey.split(':');
    if (parts.length !== 2) return this.credentials.apiKey; // Not encrypted
    
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
      iv
    );
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return this.credentials.apiKey;
  }
};

export default mongoose.model<ISocialIntegration>('SocialIntegration', SocialIntegrationSchema);

