import Settings from '../models/Settings';
import User from '../models/User';
import { AppError } from '../middleware/error.middleware';
import { inboundAgentConfigService } from './inboundAgentConfig.service';

export class SettingsService {
  /**
   * Get widget settings by widgetId (public access)
   * For now, get the first settings or default. In production, map widgetId to organization
   */
  async getWidgetSettings(widgetId: string) {
    // Try to find settings. For now, just get the first one
    // In production, you'd map widgetId to specific organization/user
    let settings = await Settings.findOne();
    
    if (!settings) {
      // Return default settings if none exist
      return {
        chatbotName: 'AI Assistant',
        chatbotAvatar: null,
        primaryColor: '#6366f1',
        autoReplyMessage: 'Hello! How can I help you today?'
      };
    }
    
    return settings;
  }

  /**
   * Get settings for a user (create default if doesn't exist)
   */
  async getSettings(userId: string) {
    let settings = await Settings.findOne({ userId });
    
    if (!settings) {
      // Create default settings
      settings = await Settings.create({
        userId,
        chatbotName: 'AI Assistant',
        primaryColor: '#6366f1',
        widgetPosition: 'right',
        language: 'en',
        emailNotifications: true,
        soundNotifications: true
      });
    }
    
    return settings;
  }

  /**
   * Update settings
   */
  async updateSettings(userId: string, data: any) {
    let settings = await Settings.findOne({ userId });
    
    if (!settings) {
      // Create if doesn't exist
      settings = await Settings.create({
        userId,
        ...data
      });
    } else {
      // Update existing
      const { ecommerceIntegration, ...safeData } = data;
Object.assign(settings, safeData);

      await settings.save();
    }
    
    // Sync inbound agent config if knowledge base settings were updated
    if (data.defaultKnowledgeBaseNames !== undefined || data.language !== undefined) {
      try {
        console.log('[Settings Service] Syncing inbound agent config...');
        await inboundAgentConfigService.syncConfig(userId);
        console.log('[Settings Service] Inbound agent config synced successfully');
      } catch (error) {
        console.error('[Settings Service] Failed to sync inbound agent config:', error);
        // Don't throw error, just log it
      }
    }
    
    return settings;
  }

  /**
   * Save e-commerce integration credentials
   * Also syncs to InboundAgentConfig
   */
  async saveEcommerceCredentials(
    userId: string,
    credentials: {
      platform: 'shopify' | 'woocommerce' | 'magento2' | 'prestashop' | 'qapla';
      base_url?: string;
      api_key?: string;
      api_secret?: string;
      access_token?: string;
    }
  ) {
    console.log('[Settings Service] Saving e-commerce credentials:', {
      userId,
      platform: credentials.platform,
      base_url: credentials.base_url,
      has_api_key: !!credentials.api_key,
      has_api_secret: !!credentials.api_secret
    });

    let settings = await Settings.findOne({ userId });
    
    if (!settings) {
      // Create if doesn't exist
      settings = await Settings.create({
        userId,
        ecommerceIntegration: credentials
      });
    } else {
      // Update e-commerce integration
      console.log('[Settings Service] Updating existing settings with e-commerce credentials');
      console.log('[Settings Service] Current ecommerceIntegration:', JSON.stringify(settings.ecommerceIntegration, null, 2));
      console.log('[Settings Service] New credentials:', JSON.stringify(credentials, null, 2));
      
      settings.ecommerceIntegration = credentials;
      await settings.save();
      
      // Verify the save worked
      const verifySettings = await Settings.findOne({ userId });
      console.log('[Settings Service] ✅ Settings saved. Verification:', {
        has_ecommerceIntegration: !!verifySettings?.ecommerceIntegration,
        platform: verifySettings?.ecommerceIntegration?.platform,
        has_base_url: !!verifySettings?.ecommerceIntegration?.base_url,
        has_api_key: !!verifySettings?.ecommerceIntegration?.api_key,
        has_api_secret: !!verifySettings?.ecommerceIntegration?.api_secret
      });
    }
    
    // Sync to InboundAgentConfig for all phone numbers
    try {
      console.log('[Settings Service] Syncing e-commerce credentials to InboundAgentConfig...');
      const syncedConfigs = await inboundAgentConfigService.syncConfig(userId);
      console.log('[Settings Service] ✅ E-commerce credentials synced to InboundAgentConfig successfully');
      console.log('[Settings Service] Synced configs count:', syncedConfigs.length);
      
      if (syncedConfigs.length > 0) {
        console.log('[Settings Service] Phone numbers with e-commerce credentials:', syncedConfigs.map(c => c.calledNumber));
      } else {
        // No phone numbers configured - create a default InboundAgentConfig for chatbot use
        console.log('[Settings Service] ⚠️  No phone numbers configured. Creating default InboundAgentConfig for chatbot use...');
        await inboundAgentConfigService.createDefaultConfigForChatbot(userId, credentials);
        console.log('[Settings Service] ✅ Default InboundAgentConfig created for chatbot use');
      }
    } catch (error) {
      console.error('[Settings Service] ❌ Failed to sync e-commerce credentials to InboundAgentConfig:', error);
      // Don't throw error, just log it - credentials are saved in Settings
      // Still try to create default config for chatbot
      try {
        console.log('[Settings Service] Attempting to create default InboundAgentConfig for chatbot...');
        await inboundAgentConfigService.createDefaultConfigForChatbot(userId, credentials);
        console.log('[Settings Service] ✅ Default InboundAgentConfig created for chatbot use');
      } catch (defaultConfigError) {
        console.error('[Settings Service] ❌ Failed to create default InboundAgentConfig:', defaultConfigError);
      }
    }
    
    console.log('[Settings Service] ✅ WooCommerce integration setup complete for user:', userId);
    return settings;
  }

  /**
   * Delete e-commerce integration credentials
   * Removes from Settings and InboundAgentConfig
   */
  async deleteEcommerceCredentials(userId: string) {
    console.log('[Settings Service] Deleting e-commerce credentials for userId:', userId);

    const settings = await Settings.findOne({ userId });
    
    if (!settings) {
      console.log('[Settings Service] ⚠️  No settings found for userId:', userId);
      throw new AppError(404, 'NOT_FOUND', 'Settings not found');
    }

    if (!settings.ecommerceIntegration || !settings.ecommerceIntegration.platform) {
      console.log('[Settings Service] ⚠️  No e-commerce integration found to delete');
      throw new AppError(404, 'NOT_FOUND', 'E-commerce integration not found');
    }

    const platform = settings.ecommerceIntegration.platform;
    console.log('[Settings Service] Removing e-commerce integration:', platform);

    // Remove e-commerce integration from Settings
    settings.ecommerceIntegration = undefined as any;
    await settings.save();
    
    // Use $unset to ensure the field is completely removed from MongoDB
    await Settings.updateOne(
      { userId },
      { $unset: { ecommerceIntegration: "" } }
    );

    console.log('[Settings Service] ✅ E-commerce credentials removed from Settings');

    // Remove from InboundAgentConfig for all phone numbers
    try {
      console.log('[Settings Service] Removing e-commerce credentials from InboundAgentConfig...');
      const configs = await inboundAgentConfigService.get(userId);
      
      const InboundAgentConfig = (await import('../models/InboundAgentConfig')).default;
      
      for (const config of configs) {
        if (config.ecommerce_credentials) {
          // Use $unset to completely remove the field
          await InboundAgentConfig.updateOne(
            { _id: config._id },
            { $unset: { ecommerce_credentials: "" } }
          );
          console.log(`[Settings Service] ✅ Removed e-commerce credentials from InboundAgentConfig for ${config.calledNumber}`);
        }
      }

      // Also remove from default chatbot config (calledNumber = '')
      try {
        const defaultConfig = await inboundAgentConfigService.getByPhoneNumber(userId, '');
        if (defaultConfig && defaultConfig.ecommerce_credentials) {
          await InboundAgentConfig.updateOne(
            { _id: defaultConfig._id },
            { $unset: { ecommerce_credentials: "" } }
          );
          console.log('[Settings Service] ✅ Removed e-commerce credentials from default chatbot config');
        }
      } catch (error) {
        console.log('[Settings Service] No default chatbot config found or error removing:', error);
      }

      console.log('[Settings Service] ✅ E-commerce credentials removed from all InboundAgentConfig documents');
    } catch (error) {
      console.error('[Settings Service] ❌ Failed to remove e-commerce credentials from InboundAgentConfig:', error);
      // Don't throw error - credentials are removed from Settings, which is the main source
    }

    console.log('[Settings Service] ✅ E-commerce integration deletion complete for user:', userId);
    return { message: 'E-commerce integration deleted successfully', platform };
  }

  /**
   * Get all operators (users)
   */
  async getOperators() {
    const users = await User.find({})
      .select('+password') // Include password field as requested
      .lean();
    return users;
  }

  /**
   * Create operator
   */
  async createOperator(data: any) {
    const existingUser = await User.findOne({ email: data.email });
    if (existingUser) {
      throw new AppError(409, 'DUPLICATE', 'User with this email already exists');
    }

    const user = await User.create({
      email: data.email,
      password: data.password, // Store plain password as requested
      firstName: data.firstName || data.name?.split(' ')[0] || '',
      lastName: data.lastName || data.name?.split(' ')[1] || '',
      role: data.role || 'operator',
      permissions: data.permissions || []
    });

    // Return user with password visible
    return user.toObject();
  }

  /**
   * Update operator
   */
  async updateOperator(id: string, data: any) {
    const user = await User.findById(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    // Update fields
    if (data.email) user.email = data.email;
    if (data.firstName) user.firstName = data.firstName;
    if (data.lastName) user.lastName = data.lastName;
    if (data.role) user.role = data.role;
    if (data.permissions) user.permissions = data.permissions;
    if (data.password) user.password = data.password; // Update plain password
    
    // Handle legacy name field
    if (data.name && !data.firstName && !data.lastName) {
      user.firstName = data.name.split(' ')[0] || '';
      user.lastName = data.name.split(' ')[1] || '';
    }

    await user.save();

    return user.toObject();
  }

  /**
   * Delete operator
   */
  async deleteOperator(id: string) {
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    return { message: 'User deleted successfully' };
  }
}

export const settingsService = new SettingsService();

