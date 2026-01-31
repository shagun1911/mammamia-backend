import PhoneSettings, { IPhoneSettings } from '../models/PhoneSettings';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';
import { inboundAgentConfigService } from './inboundAgentConfig.service';
import PhoneNumber from '../models/PhoneNumber';

export class PhoneSettingsService {
  /**
   * Get phone settings for a user (creates default if doesn't exist)
   */
  async get(userId: string) {
    // Convert userId to ObjectId for query
    const userObjectId = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
    
    let settings = await PhoneSettings.findOne({ userId: userObjectId });
    
    if (!settings) {
      // Create default settings if none exist
      settings = await PhoneSettings.create({
        userId: userObjectId,
        selectedVoice: 'adam',
        twilioPhoneNumber: '',
        livekitSipTrunkId: '',
        humanOperatorPhone: '',
        isConfigured: false
      });
    }
    
    return settings;
  }

  /**
   * Update phone settings
   */
  async update(
    userId: string,
    data: {
      selectedVoice?: string;
      customVoiceId?: string;
      twilioPhoneNumber?: string;
      livekitSipTrunkId?: string;
      twilioTrunkSid?: string;
      terminationUri?: string;
      originationUri?: string;
      humanOperatorPhone?: string;
      greetingMessage?: string;
      language?: string;
      // Generic SIP Trunk fields
      sipAddress?: string;
      sipUsername?: string;
      providerName?: string;
      transport?: string;
      // Inbound Trunk fields
      inboundTrunkId?: string;
      inboundTrunkName?: string;
      inboundPhoneNumbers?: string[];
      inboundDispatchRuleId?: string;
      inboundDispatchRuleName?: string;
    }
  ) {
    const settings = await this.get(userId);

    // Update fields
    if (data.selectedVoice !== undefined) {
      settings.selectedVoice = data.selectedVoice;
    }
    if (data.customVoiceId !== undefined) {
      settings.customVoiceId = data.customVoiceId;
    }
    if (data.twilioPhoneNumber !== undefined) {
      settings.twilioPhoneNumber = data.twilioPhoneNumber;
    }
    if (data.livekitSipTrunkId !== undefined) {
      settings.livekitSipTrunkId = data.livekitSipTrunkId;
    }
    if (data.twilioTrunkSid !== undefined) {
      settings.twilioTrunkSid = data.twilioTrunkSid;
    }
    if (data.terminationUri !== undefined) {
      settings.terminationUri = data.terminationUri;
    }
    if (data.originationUri !== undefined) {
      settings.originationUri = data.originationUri;
    }
    if (data.humanOperatorPhone !== undefined) {
      settings.humanOperatorPhone = data.humanOperatorPhone;
    }
    if (data.greetingMessage !== undefined) {
      console.log('[PhoneSettings Service] Setting greetingMessage:', data.greetingMessage);
      settings.greetingMessage = data.greetingMessage;
    }
    if (data.language !== undefined) {
      console.log('[PhoneSettings Service] Setting language:', data.language);
      settings.language = data.language;
    }

    // Generic SIP Trunk fields
    if (data.sipAddress !== undefined) {
      settings.sipAddress = data.sipAddress;
    }
    if (data.sipUsername !== undefined) {
      settings.sipUsername = data.sipUsername;
    }
    if (data.providerName !== undefined) {
      settings.providerName = data.providerName;
    }
    if (data.transport !== undefined) {
      settings.transport = data.transport;
    }

    // Inbound Trunk fields
    console.log('[PhoneSettings Service] Updating inbound fields...');
    console.log('[PhoneSettings Service] Received data:', JSON.stringify(data, null, 2));
    
    if (data.inboundTrunkId !== undefined) {
      console.log('[PhoneSettings Service] Setting inboundTrunkId:', data.inboundTrunkId);
      settings.inboundTrunkId = data.inboundTrunkId;
    }
    if (data.inboundTrunkName !== undefined) {
      console.log('[PhoneSettings Service] Setting inboundTrunkName:', data.inboundTrunkName);
      settings.inboundTrunkName = data.inboundTrunkName;
    }
    if (data.inboundPhoneNumbers !== undefined) {
      console.log('[PhoneSettings Service] Current inboundPhoneNumbers:', settings.inboundPhoneNumbers);
      console.log('[PhoneSettings Service] New inboundPhoneNumbers:', data.inboundPhoneNumbers);
      settings.inboundPhoneNumbers = data.inboundPhoneNumbers;
      console.log('[PhoneSettings Service] Updated inboundPhoneNumbers:', settings.inboundPhoneNumbers);
    }
    if (data.inboundDispatchRuleId !== undefined) {
      console.log('[PhoneSettings Service] Setting inboundDispatchRuleId:', data.inboundDispatchRuleId);
      settings.inboundDispatchRuleId = data.inboundDispatchRuleId;
    }
    if (data.inboundDispatchRuleName !== undefined) {
      console.log('[PhoneSettings Service] Setting inboundDispatchRuleName:', data.inboundDispatchRuleName);
      settings.inboundDispatchRuleName = data.inboundDispatchRuleName;
    }

    console.log('[PhoneSettings Service] Before save:', {
      inboundTrunkId: settings.inboundTrunkId,
      inboundTrunkName: settings.inboundTrunkName,
      inboundPhoneNumbers: settings.inboundPhoneNumbers,
      inboundDispatchRuleId: settings.inboundDispatchRuleId,
      inboundDispatchRuleName: settings.inboundDispatchRuleName,
    });

    // Check if all required fields are configured
    // Support both old system (twilioPhoneNumber + livekitSipTrunkId) and new system (PhoneNumber collection)
    const userIdObjId = settings.userId instanceof mongoose.Types.ObjectId 
      ? settings.userId 
      : new mongoose.Types.ObjectId(String(settings.userId));
    
    // Check if user has any phone numbers in the new PhoneNumber collection
    const phoneNumbersCount = await PhoneNumber.countDocuments({
      $or: [
        { organizationId: userIdObjId },
        { organizationId: settings.userId }
      ]
    });
    
    // Configured if: (old system has twilioPhoneNumber + livekitSipTrunkId) OR (new system has phone numbers)
    const hasOldSystem = !!(settings.twilioPhoneNumber && settings.livekitSipTrunkId);
    const hasNewSystem = phoneNumbersCount > 0;
    
    settings.isConfigured = !!(
      settings.selectedVoice &&
      (hasOldSystem || hasNewSystem)
    );

    await settings.save();
    
    console.log('[PhoneSettings Service] After save:', {
      inboundTrunkId: settings.inboundTrunkId,
      inboundTrunkName: settings.inboundTrunkName,
      inboundPhoneNumbers: settings.inboundPhoneNumbers,
      inboundDispatchRuleId: settings.inboundDispatchRuleId,
      inboundDispatchRuleName: settings.inboundDispatchRuleName,
    });
    
    // Sync inbound agent config after phone settings update
    // Trigger sync if inboundPhoneNumbers OR voice settings are updated
    const shouldSync = data.inboundPhoneNumbers !== undefined || 
                       data.selectedVoice !== undefined || 
                       data.customVoiceId !== undefined;
    
    if (shouldSync) {
      try {
        console.log('[PhoneSettings Service] Triggering inbound agent config sync...');
        console.log('[PhoneSettings Service] Sync reason:', {
          phoneNumbersUpdated: data.inboundPhoneNumbers !== undefined,
          voiceUpdated: data.selectedVoice !== undefined || data.customVoiceId !== undefined
        });
        console.log('[PhoneSettings Service] UserId for sync:', userId);
        console.log('[PhoneSettings Service] Phone numbers for sync:', settings.inboundPhoneNumbers);
        console.log('[PhoneSettings Service] Voice settings:', {
          selectedVoice: settings.selectedVoice,
          customVoiceId: settings.customVoiceId
        });
        
        const syncedConfigs = await inboundAgentConfigService.syncConfig(userId);
        
        console.log('[PhoneSettings Service] Inbound agent config synced successfully');
        console.log('[PhoneSettings Service] Synced configs count:', syncedConfigs.length);
      } catch (error: any) {
        console.error('[PhoneSettings Service] Failed to sync inbound agent config:', error);
        console.error('[PhoneSettings Service] Error details:', error.message, error.stack);
        // Don't throw error, just log it - phone settings update should succeed even if sync fails
      }
    }
    
    return settings;
  }

  /**
   * Delete phone settings
   */
  async delete(userId: string): Promise<void> {
    await PhoneSettings.findOneAndDelete({ userId });
  }
}

export const phoneSettingsService = new PhoneSettingsService();

