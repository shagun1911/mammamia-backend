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
      Object.assign(settings, data);
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

