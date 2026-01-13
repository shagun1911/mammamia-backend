import SocialIntegration, { ISocialIntegration } from '../models/SocialIntegration';
import { Dialog360Service } from './dialog360.service';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

export class SocialIntegrationService {
  /**
   * Create or update social integration
   */
  async upsertIntegration(data: {
    organizationId: string;
    platform: 'whatsapp' | 'instagram' | 'facebook';
    apiKey: string;
    clientId?: string;
    phoneNumberId?: string;
    wabaId?: string;
    instagramAccountId?: string;
    facebookPageId?: string;
  }): Promise<ISocialIntegration> {
    try {
      // Verify the credentials work
      const dialog360 = new Dialog360Service({
        apiKey: data.apiKey,
        phoneNumberId: data.phoneNumberId,
        instagramAccountId: data.instagramAccountId,
        facebookPageId: data.facebookPageId
      });

      const isValid = await dialog360.verifyConnection();
      if (!isValid) {
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Invalid credentials - could not verify connection with 360dialog');
      }

      // Update or create integration
      const integration = await SocialIntegration.findOneAndUpdate(
        {
          organizationId: new mongoose.Types.ObjectId(data.organizationId),
          platform: data.platform
        },
        {
          $set: {
            credentials: {
              apiKey: data.apiKey, // Will be encrypted by pre-save hook
              clientId: data.clientId,
              phoneNumberId: data.phoneNumberId,
              wabaId: data.wabaId,
              instagramAccountId: data.instagramAccountId,
              facebookPageId: data.facebookPageId
            },
            status: 'connected',
            lastSyncedAt: new Date(),
            webhookVerified: true,
            errorMessage: undefined
          }
        },
        { upsert: true, new: true }
      );

      return integration;
    } catch (error: any) {
      console.error('Error upserting social integration:', error);
      
      // Save as error state
      const integration = await SocialIntegration.findOneAndUpdate(
        {
          organizationId: new mongoose.Types.ObjectId(data.organizationId),
          platform: data.platform
        },
        {
          $set: {
            credentials: {
              apiKey: data.apiKey,
              clientId: data.clientId,
              phoneNumberId: data.phoneNumberId,
              wabaId: data.wabaId,
              instagramAccountId: data.instagramAccountId,
              facebookPageId: data.facebookPageId
            },
            status: 'error',
            errorMessage: error.message,
            webhookVerified: false
          }
        },
        { upsert: true, new: true }
      );

      throw new AppError(400, 'CONNECTION_FAILED', error.message || 'Failed to connect integration');
    }
  }

  /**
   * Get all integrations for an organization
   */
  async getIntegrations(organizationId: string): Promise<ISocialIntegration[]> {
    const integrations = await SocialIntegration.find({
      organizationId: new mongoose.Types.ObjectId(organizationId)
    }).lean();

    // Remove encrypted API keys from response
    return integrations.map(integration => ({
      ...integration,
      credentials: {
        ...integration.credentials,
        apiKey: '***********' // Mask the API key
      }
    })) as any;
  }

  /**
   * Get specific integration
   */
  async getIntegration(
    organizationId: string,
    platform: 'whatsapp' | 'instagram' | 'facebook'
  ): Promise<ISocialIntegration | null> {
    return await SocialIntegration.findOne({
      organizationId: new mongoose.Types.ObjectId(organizationId),
      platform
    });
  }

  /**
   * Get Dialog360 service instance for an organization
   */
  async getDialog360Service(
    organizationId: string,
    platform: 'whatsapp' | 'instagram' | 'facebook'
  ): Promise<Dialog360Service> {
    const integration = await this.getIntegration(organizationId, platform);
    
    if (!integration || integration.status !== 'connected') {
      throw new AppError(400, 'NOT_CONNECTED', `${platform} not connected for this organization`);
    }

    const apiKey = (integration as any).getDecryptedApiKey();

    return new Dialog360Service({
      apiKey,
      phoneNumberId: integration.credentials.phoneNumberId,
      instagramAccountId: integration.credentials.instagramAccountId,
      facebookPageId: integration.credentials.facebookPageId
    });
  }

  /**
   * Disconnect integration
   */
  async disconnectIntegration(
    organizationId: string,
    platform: 'whatsapp' | 'instagram' | 'facebook'
  ): Promise<void> {
    await SocialIntegration.findOneAndUpdate(
      {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        platform
      },
      {
        $set: {
          status: 'disconnected',
          webhookVerified: false
        }
      }
    );
  }

  /**
   * Delete integration
   */
  async deleteIntegration(
    organizationId: string,
    platform: 'whatsapp' | 'instagram' | 'facebook'
  ): Promise<void> {
    await SocialIntegration.findOneAndDelete({
      organizationId: new mongoose.Types.ObjectId(organizationId),
      platform
    });
  }

  /**
   * Test integration connection
   */
  async testConnection(
    organizationId: string,
    platform: 'whatsapp' | 'instagram' | 'facebook'
  ): Promise<boolean> {
    try {
      const dialog360 = await this.getDialog360Service(organizationId, platform);
      return await dialog360.verifyConnection();
    } catch (error) {
      return false;
    }
  }
}

export default new SocialIntegrationService();

