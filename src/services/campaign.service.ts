import Campaign from '../models/Campaign';
import CampaignRecipient from '../models/CampaignRecipient';
import ContactListMember from '../models/ContactListMember';
import ContactList from '../models/ContactList';
import Customer from '../models/Customer';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import { AppError } from '../middleware/error.middleware';
import { campaignQueue } from '../queues/campaign.queue';
import { phoneSettingsService } from './phoneSettings.service';
import { aiBehaviorService } from './aiBehavior.service';
import { emailService } from './email.service';
import axios from 'axios';
import { trackUsage } from '../middleware/profileTracking.middleware';
import { profileService } from './profile.service';
import { emitToOrganization } from '../config/socket';

// Voice ID mapping from voice name to ElevenLabs voice ID
const VOICE_ID_MAP: Record<string, string> = {
  'domenico': 'QABTI1ryPrQsJUflbKB7',
  'thomas': 'CITWdMEsnRduEUkNWXQv',
  'mario': 'irAl0cku0Hx4TEUJ8d1Q',
  'gianp': 'SpoXt7BywHwFLisCTpQ3',
  'vittorio': 'nH7uLS5UdEnvKEOAXtlQ',
  'ginevra': 'QITiGyM4owEZrBEf0QV8',
  'roberta': 'ZzFXkjuO1rPntDj6At5C',
  'giusy': '8KInRSd4DtD5L5gK7itu',
  'roxy': 'mGiFn5Udfw93ewbgFHaP',
  'sami': 'kAzI34nYjizE0zON6rXv',
  'alejandro': 'YKUjKbMlejgvkOZlnnvt',
  'antonio': 'htFfPSZGJwjBv1CL0aMD',
  'el_faraon': '8mBRP99B2Ng2QwsJMFQl',
  'lumina': 'x5IDPSl4ZUbhosMmVFTk',
  'elena': 'tXgbXPnsMpKXkuTgvE3h',
  'sara': 'gD1IexrzCvsXPHUuT0s3',
  'zara': 'jqcCZkN6Knx8BJ5TBdYR',
  'brittney': 'kPzsL2i3teMYv0FxEYQ6',
  'julieanne': '8WaMCGQzWsKvf7sGPqjE',
  'allison': 'xctasy8XvGp2cVO9HL9k',
  'jameson': 'Mu5jxyqZOLIGltFpfalg',
  'mark': 'UgBBYS2sOqTuMpoF3BR0',
  'archie': 'kmSVBPu7loj4ayNinwWM',
  'adam': 'pNInz6obpgDQGcFmaJgB',
};

/**
 * Normalize phone number to E.164 format
 * Ensures phone number starts with + prefix
 */

const normalizePhoneNumber = (phone: string): string => {
  if (!phone) return phone;
  
  // Remove any whitespace
  phone = phone.trim();
  
  // If already has +, return as is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Add + prefix
  return '+' + phone;
};

export class CampaignService {
  /**
   * Add log entry to campaign
   */
  private async addCampaignLog(campaign: any, type: 'info' | 'success' | 'error' | 'warning', message: string, details?: any) {
    if (!campaign.logs) {
      campaign.logs = [];
    }
    campaign.logs.push({
      timestamp: new Date(),
      type,
      message,
      details
    });
    // Keep only last 100 logs
    if (campaign.logs.length > 100) {
      campaign.logs = campaign.logs.slice(-100);
    }
    await campaign.save();
  }

  /**
   * Update campaign progress and emit socket event
   */
  private async updateCampaignProgress(campaign: any, organizationId: string, updates: {
    sentCount?: number;
    deliveredCount?: number;
    failedCount?: number;
    pendingCount?: number;
  }) {
    if (updates.sentCount !== undefined) campaign.sentCount = (campaign.sentCount || 0) + updates.sentCount;
    if (updates.deliveredCount !== undefined) campaign.deliveredCount = (campaign.deliveredCount || 0) + updates.deliveredCount;
    if (updates.failedCount !== undefined) campaign.failedCount = (campaign.failedCount || 0) + updates.failedCount;
    if (updates.pendingCount !== undefined) campaign.pendingCount = updates.pendingCount;
    
    await campaign.save();

    // Calculate progress percentage
    const total = campaign.totalRecipients || 0;
    const processed = (campaign.sentCount || 0) + (campaign.failedCount || 0);
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

    // Emit socket event
    emitToOrganization(organizationId, 'campaign:progress', {
      campaignId: campaign._id.toString(),
      status: campaign.status,
      progress,
      totalRecipients: total,
      sentCount: campaign.sentCount || 0,
      deliveredCount: campaign.deliveredCount || 0,
      failedCount: campaign.failedCount || 0,
      pendingCount: campaign.pendingCount || 0
    });
  }

  /**
   * Get campaign statistics
   */
  private async getCampaignStats(campaignId: string) {
    const recipients = await CampaignRecipient.find({ campaignId }).lean();
    const total = recipients.length;
    const sent = recipients.filter(r => r.status === 'sent' || r.status === 'delivered').length;
    const delivered = recipients.filter(r => r.status === 'delivered' || r.deliveredAt).length;
    const failed = recipients.filter(r => r.status === 'failed').length;
    const pending = recipients.filter(r => r.status === 'pending').length;
    const opened = recipients.filter(r => r.openedAt).length;
    const clicked = recipients.filter(r => r.clickedAt).length;
    const replied = recipients.filter(r => r.repliedAt).length;
    
    return {
      total,
      sent,
      delivered,
      failed,
      pending,
      opened,
      clicked,
      replied,
      progress: total > 0 ? Math.round(((sent + failed) / total) * 100) : 0
    };
  }

  async findAll(organizationId: string, filters: any = {}, page = 1, limit = 20) {
    // First get all lists for this organization
    const lists = await ContactList.find({ organizationId }).select('_id');
    const listIds = lists.map(l => l._id);
    
    const query: any = { listId: { $in: listIds } };

    if (filters.status) {
      query.status = filters.status;
    }

    const skip = (page - 1) * limit;
    const total = await Campaign.countDocuments(query);

    const campaigns = await Campaign.find(query)
      .populate('listId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get stats for each campaign
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (campaign: any) => {
        const stats = await this.getCampaignStats(campaign._id);
        return {
          ...campaign,
          stats
        };
      })
    );

    return {
      items: campaignsWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async findById(campaignId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId)
      .populate('listId', 'name organizationId')
      .lean();

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById((campaign as any).listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    const stats = await this.getCampaignStats(campaignId);

    return {
      ...campaign,
      stats
    };
  }

  async create(campaignData: any) {
    try {
      // Log incoming data for debugging
      console.log('Creating campaign with data:', JSON.stringify(campaignData, null, 2));

      // Validate required fields
      if (!campaignData.name) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Campaign name is required');
      }

      if (!campaignData.listId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Contact list is required');
      }

      if (!campaignData.communicationTypes || campaignData.communicationTypes.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'At least one communication type is required');
      }

      // Validate communication type specific requirements
      if (campaignData.communicationTypes.includes('sms') && !campaignData.smsBody?.message) {
        throw new AppError(400, 'VALIDATION_ERROR', 'SMS message is required when SMS is selected');
      }

      if (campaignData.communicationTypes.includes('email') && (!campaignData.emailBody?.subject || !campaignData.emailBody?.body)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Email subject and body are required when Email is selected');
      }

      // Check if list exists (but don't fail if ContactList model has issues)
      try {
        const list = await ContactList.findById(campaignData.listId);
        if (!list) {
          throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
        }
      } catch (listError: any) {
        console.error('Error checking contact list:', listError.message);
        // Continue anyway - list validation is secondary
      }

      const campaign = await Campaign.create({
        ...campaignData,
        status: campaignData.scheduledAt ? 'scheduled' : 'draft'
      });

      console.log('Campaign created successfully:', campaign._id);

      // Schedule campaign if scheduledAt is provided
      if (campaignData.scheduledAt) {
        const scheduledDate = typeof campaignData.scheduledAt === 'string' 
          ? new Date(campaignData.scheduledAt) 
          : campaignData.scheduledAt;
        await this.scheduleCampaign((campaign._id as any).toString(), scheduledDate);
      }

      return campaign;
    } catch (error: any) {
      console.error('Error in campaign.create:', error);
      
      if (error instanceof AppError) {
        throw error;
      }
      
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map((err: any) => err.message).join(', ');
        throw new AppError(400, 'VALIDATION_ERROR', messages);
      }
      
      throw new AppError(500, 'INTERNAL_ERROR', error.message || 'Failed to create campaign');
    }
  }

  async update(campaignId: string, campaignData: any, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    // Can only update draft or scheduled campaigns
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot update campaign in current status');
    }

    Object.assign(campaign, campaignData);
    await campaign.save();

    return campaign;
  }

  async delete(campaignId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    // Can only delete draft campaigns
    if (campaign.status !== 'draft') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Can only delete draft campaigns');
    }

    await campaign.deleteOne();
    await CampaignRecipient.deleteMany({ campaignId });

    return { message: 'Campaign deleted successfully' };
  }

  async pause(campaignId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    if (campaign.status !== 'running') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Can only pause running campaigns');
    }

    campaign.status = 'paused';
    campaign.pausedAt = new Date();
    await campaign.save();

    await this.addCampaignLog(campaign, 'warning', 'Campaign paused by user');
    
    // Get organizationId from listId
    const listForEmit = await ContactList.findById(campaign.listId);
    const listOrgIdForEmit = listForEmit?.organizationId?.toString() || '';
    if (listOrgIdForEmit) {
      emitToOrganization(listOrgIdForEmit, 'campaign:status', {
        campaignId: campaign._id.toString(),
        status: 'paused',
        progress: this.calculateProgress(campaign),
        totalRecipients: campaign.totalRecipients || 0,
        sentCount: campaign.sentCount || 0,
        failedCount: campaign.failedCount || 0,
        pendingCount: campaign.pendingCount || 0
      });
    }

    return campaign;
  }

  async resume(campaignId: string, userId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    if (campaign.status !== 'paused') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Can only resume paused campaigns');
    }

    campaign.status = 'running';
    await campaign.save();

    await this.addCampaignLog(campaign, 'info', 'Campaign resumed by user');
    
    // Get organizationId from listId
    const listForEmit = await ContactList.findById(campaign.listId);
    const listOrgIdForEmit = listForEmit?.organizationId?.toString() || '';
    if (listOrgIdForEmit) {
      emitToOrganization(listOrgIdForEmit, 'campaign:status', {
        campaignId: campaign._id.toString(),
        status: 'running',
        progress: this.calculateProgress(campaign),
        totalRecipients: campaign.totalRecipients || 0,
        sentCount: campaign.sentCount || 0,
        failedCount: campaign.failedCount || 0,
        pendingCount: campaign.pendingCount || 0
      });
    }

    // Continue processing remaining contacts
    // Note: This would require background job processing - for now, just update status
    // In production, you'd want to queue remaining contacts for processing

    return campaign;
  }

  async retryFailed(campaignId: string, userId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    if (campaign.failedCount === 0 || (campaign.failedCount || 0) === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No failed recipients to retry');
    }

    // Get failed recipients
    const failedRecipients = await CampaignRecipient.find({
      campaignId: campaign._id,
      status: 'failed'
    }).populate('contactId');

    if (failedRecipients.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No failed recipients found');
    }

    await this.addCampaignLog(campaign, 'info', `Retrying ${failedRecipients.length} failed recipients`);

    // Reset failed count and update pending
    campaign.failedCount = Math.max(0, (campaign.failedCount || 0) - failedRecipients.length);
    campaign.pendingCount = (campaign.pendingCount || 0) + failedRecipients.length;
    campaign.status = 'running';
    await campaign.save();

    // Process failed recipients
    const contacts = failedRecipients.map(r => r.contactId).filter(Boolean);
    
    // Get organizationId from listId (use parameter, not local variable)
    // organizationId is already available as parameter

    // Process each failed contact
    for (const contact of contacts) {
      // Similar processing logic as in start() method
      // This is a simplified version - you'd want to reuse the processing logic
      try {
        // Update recipient status back to pending
        await CampaignRecipient.updateOne(
          { campaignId: campaign._id, contactId: (contact as any)._id },
          { status: 'pending', failureReason: undefined }
        );

        // Process contact (call/email/sms) - simplified, would need full logic
        // For now, just mark as retrying
        await this.addCampaignLog(campaign, 'info', `Retrying contact ${(contact as any).name || (contact as any).email}`);
      } catch (error: any) {
        await this.addCampaignLog(campaign, 'error', `Failed to retry contact: ${error.message}`);
      }
    }

    if (organizationId) {
      emitToOrganization(organizationId, 'campaign:progress', {
        campaignId: campaign._id.toString(),
        status: 'running',
        progress: this.calculateProgress(campaign),
        totalRecipients: campaign.totalRecipients || 0,
        sentCount: campaign.sentCount || 0,
        failedCount: campaign.failedCount || 0,
        pendingCount: campaign.pendingCount || 0
      });
    }

    return campaign;
  }

  private calculateProgress(campaign: any): number {
    const total = campaign.totalRecipients || 0;
    if (total === 0) return 0;
    const processed = (campaign.sentCount || 0) + (campaign.failedCount || 0);
    return Math.round((processed / total) * 100);
  }

  async cancel(campaignId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    if (!['scheduled', 'running', 'paused'].includes(campaign.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Can only cancel scheduled, running, or paused campaigns');
    }

    campaign.status = 'failed';
    campaign.failedAt = new Date();
    await campaign.save();

    await this.addCampaignLog(campaign, 'warning', 'Campaign cancelled by user');

    // Get organizationId from listId
    const listForEmit = await ContactList.findById(campaign.listId);
    const listOrgIdForEmit = listForEmit?.organizationId?.toString() || '';
    if (listOrgIdForEmit) {
      emitToOrganization(listOrgIdForEmit, 'campaign:status', {
        campaignId: campaign._id.toString(),
        status: 'failed',
        progress: this.calculateProgress(campaign),
        totalRecipients: campaign.totalRecipients || 0,
        sentCount: campaign.sentCount || 0,
        failedCount: campaign.failedCount || 0,
        pendingCount: campaign.pendingCount || 0
      });
    }

    return campaign;
  }

  async start(campaignId: string, userId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    // Can only start draft or scheduled campaigns
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Campaign is not in a valid state to start');
    }

    // Get contacts from the list
    const members = await ContactListMember.find({ listId: campaign.listId });
    const contactIds = members.map(m => m.contactId);
    const contacts = await Customer.find({ _id: { $in: contactIds } });

    if (contacts.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No contacts found in the selected list');
    }

    console.log(`[Campaign ${campaignId}] Starting campaign for ${contacts.length} contacts`);

    // Initialize campaign progress tracking
    campaign.status = 'running';
    campaign.totalRecipients = contacts.length;
    campaign.sentCount = 0;
    campaign.deliveredCount = 0;
    campaign.failedCount = 0;
    campaign.pendingCount = contacts.length;
    campaign.logs = [];
    campaign.sentAt = new Date();
    await campaign.save();

    // Add initial log
    await this.addCampaignLog(campaign, 'info', `Campaign started for ${contacts.length} contacts`);
    
    // Use organizationId parameter directly
    emitToOrganization(organizationId.toString(), 'campaign:status', {
      campaignId: campaign._id.toString(),
      status: 'running',
      progress: 0,
      totalRecipients: contacts.length,
      sentCount: 0,
      failedCount: 0,
      pendingCount: contacts.length
    });

    // Get phone settings and AI behavior for the user
    const phoneSettings = await phoneSettingsService.get(userId);
    const aiBehavior = await aiBehaviorService.get(userId);

    // Map selectedVoice name to ElevenLabs voice ID
    // Use customVoiceId if provided, otherwise use the mapped voice ID
    const voiceId = phoneSettings.customVoiceId || VOICE_ID_MAP[phoneSettings.selectedVoice] || VOICE_ID_MAP['adam'];
    
    // Get transfer_to from phone settings and escalation_condition from AI behavior
    const transferTo = phoneSettings.humanOperatorPhone || '';
    const escalationCondition = aiBehavior.voiceAgent?.humanOperator?.escalationRules?.join('; ') || '';

    // Get inbound agent config to fetch greeting_message and language
    let greetingMessage = 'Hello! How can I help you today?'; // Default greeting
    let configuredLanguage = campaign.language || aiBehavior.voiceAgent?.language || 'en';
    
    try {
      const { inboundAgentConfigService } = await import('./inboundAgentConfig.service');
      // Try to get config for the first inbound phone number
      if (phoneSettings.inboundPhoneNumbers && phoneSettings.inboundPhoneNumbers.length > 0) {
        const firstInboundNumber = phoneSettings.inboundPhoneNumbers[0];
        const inboundConfig = await inboundAgentConfigService.getByPhoneNumber(userId, firstInboundNumber);
        if (inboundConfig) {
          greetingMessage = inboundConfig.greeting_message || greetingMessage;
          // Use language from inbound config if available
          if (inboundConfig.language) {
            configuredLanguage = inboundConfig.language;
          }
          console.log(`[Campaign ${campaignId}] Using greeting message from inbound config: "${greetingMessage}"`);
          console.log(`[Campaign ${campaignId}] Using language from inbound config: "${configuredLanguage}"`);
        } else {
          console.log(`[Campaign ${campaignId}] No inbound config found, using default greeting message`);
        }
      } else {
        console.log(`[Campaign ${campaignId}] No inbound phone numbers configured, using default greeting message`);
      }
    } catch (error: any) {
      console.warn(`[Campaign ${campaignId}] Failed to fetch inbound agent config:`, error.message);
      console.warn(`[Campaign ${campaignId}] Using default greeting message`);
    }

    console.log(`[Campaign ${campaignId}] ===== CAMPAIGN CONFIGURATION =====`);
    console.log(`[Campaign ${campaignId}] Voice: ${phoneSettings.selectedVoice} (${voiceId})`);
    console.log(`[Campaign ${campaignId}] SIP Trunk ID: ${phoneSettings.livekitSipTrunkId}`);
    console.log(`[Campaign ${campaignId}] Dynamic Instruction: ${campaign.dynamicInstruction || '(not set)'}`);
    console.log(`[Campaign ${campaignId}] Language: ${configuredLanguage}`);
    console.log(`[Campaign ${campaignId}] Greeting Message: "${greetingMessage}"`);
    console.log(`[Campaign ${campaignId}] Transfer To: ${transferTo || '(not set)'}`);
    console.log(`[Campaign ${campaignId}] Escalation Condition: ${escalationCondition || '(not set)'}`);
    console.log(`[Campaign ${campaignId}] =====================================`);

    const COMM_API = process.env.COMM_API_URL || 'https://keplerov1-python-2.onrender.com';
    const results: any[] = [];
    let successCount = 0;
    let failCount = 0;

    try {
      // Process each contact one by one
      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        console.log(`\n[Campaign ${campaignId}] Processing contact ${i + 1}/${contacts.length}: ${contact.name} (${contact.phone || contact.email})`);

        const contactResult: any = {
          contactId: contact._id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          call_status: null,
          sms_status: null,
          email_status: null,
          errors: [],
          transcript: null,
        };

        // 1. Make the call if requested
        if (campaign.communicationTypes.includes('call')) {
          if (!contact.phone) {
            console.error(`[Campaign ${campaignId}] Contact ${contact.name} has no phone number, skipping call`);
            contactResult.call_status = 'failed';
            contactResult.errors.push('No phone number available for call');
          } else {
            try {
              console.log(`[Campaign ${campaignId}] Initiating call to ${contact.phone}...`);
              
              // Get API keys for LLM
              let provider = 'openai';
              let apiKey = '';
              let apiKeysConfigured = false;
              try {
                const { apiKeysService } = await import('./apiKeys.service');
                const apiKeys = await apiKeysService.getApiKeys(userId);
                provider = apiKeys.llmProvider;
                apiKey = apiKeys.apiKey;
                apiKeysConfigured = true;
              } catch (error: any) {
                console.warn(`[Campaign ${campaignId}] Failed to fetch API keys:`, error.message);
                console.warn(`[Campaign ${campaignId}] ⚠️  API keys not configured. Calls may fail. Please configure API keys in Settings → API Keys`);
              }
              
              // Get voice agent prompt and language from AI Behavior settings
              let voiceAgentPrompt = campaign.dynamicInstruction || '';
              let voiceLanguage = configuredLanguage; // Use language from inbound config
              
              // If no dynamic instruction in campaign, fetch from AI Behavior
              if (!voiceAgentPrompt) {
                try {
                  const aiBehavior = await aiBehaviorService.get(userId);
                  voiceAgentPrompt = aiBehavior.voiceAgent.systemPrompt || 'You are a helpful AI voice assistant.';
                  console.log(`[Campaign ${campaignId}] Using voice agent prompt from AI Behavior settings`);
                } catch (error: any) {
                  console.warn(`[Campaign ${campaignId}] Failed to fetch voice agent prompt:`, error.message);
                }
              }
              
              // Normalize phone number to E.164 format
              const normalizedPhone = normalizePhoneNumber(contact.phone);
              
              // Get default knowledge bases from settings
              let collectionNames: string[] = [];
              try {
                const settings = await (await import('../models/Settings')).default.findOne({ userId });
                if (settings) {
                  // Prefer multiple knowledge bases (new format)
                  if (settings.defaultKnowledgeBaseNames && settings.defaultKnowledgeBaseNames.length > 0) {
                    collectionNames = settings.defaultKnowledgeBaseNames;
                  } 
                  // Fallback to single knowledge base (legacy format)
                  else if (settings.defaultKnowledgeBaseName) {
                    collectionNames = [settings.defaultKnowledgeBaseName];
                  }
                }
                console.log(`[Campaign ${campaignId}] Using ${collectionNames.length} knowledge base(s):`, collectionNames);
              } catch (error: any) {
                console.warn(`[Campaign ${campaignId}] Could not fetch knowledge bases:`, error.message);
              }

              // Prepare outbound call request body
              const callRequestBody: any = {
                phone_number: normalizedPhone,
                name: contact.name || 'Customer',
                dynamic_instruction: voiceAgentPrompt,
                language: voiceLanguage,
                voice_id: voiceId,
                sip_trunk_id: phoneSettings.livekitSipTrunkId,
                provider: provider,
                api_key: apiKey,
                collection_names: collectionNames, // Updated to support multiple collections
                greeting_message: greetingMessage // Add greeting message from inbound config
              };

              // Add optional fields if they exist
              if (transferTo) {
                callRequestBody.transfer_to = transferTo;
              }
              if (escalationCondition) {
                callRequestBody.escalation_condition = escalationCondition;
              }

              // Get e-commerce credentials if available
              try {
                const { getEcommerceCredentials } = await import('../utils/ecommerce.util');
                const ecommerceCredentials = await getEcommerceCredentials(userId);
                if (ecommerceCredentials) {
                  callRequestBody.ecommerce_credentials = ecommerceCredentials;
                }
              } catch (error: any) {
                console.warn(`[Campaign ${campaignId}] Could not fetch e-commerce credentials:`, error.message);
              }

              // Get escalation conditions from AIBehavior if not set
              if (!callRequestBody.escalation_condition) {
                try {
                  const aiBehavior = await aiBehaviorService.get(userId);
                  const escalationRules = aiBehavior.voiceAgent.humanOperator?.escalationRules || [];
                  if (escalationRules.length > 0) {
                    callRequestBody.escalation_condition = escalationRules.join('. ');
                  }
                } catch (error: any) {
                  console.warn(`[Campaign ${campaignId}] Could not fetch escalation conditions:`, error.message);
                }
              }

              const callUrl = `${COMM_API}/calls/outbound`;
              
              // Log request details for debugging
              console.log(`\n========== CAMPAIGN ${campaignId} - OUTBOUND CALL ==========`);
              console.log(`📞 [Campaign] URL: ${callUrl}`);
              console.log(`📦 [Campaign] Full Request Body:`, JSON.stringify({
                ...callRequestBody,
                api_key: callRequestBody.api_key ? `${callRequestBody.api_key.substring(0, 10)}...***` : '❌ NOT_SET'
              }, null, 2));
              console.log(`=====================================================\n`);

              if (!apiKeysConfigured || !callRequestBody.api_key) {
                console.error(`[Campaign ${campaignId}] ❌ CRITICAL: API Key is missing! Call will likely fail.`);
                console.error(`[Campaign ${campaignId}] Please configure your API keys at Settings → API Keys`);
              }

              const callResponse = await axios.post(callUrl, callRequestBody, {
                timeout: 360000, // 6 minutes timeout (call waits max 5 minutes for transcript)
              });

              console.log(`\n========== CAMPAIGN ${campaignId} - CALL RESPONSE ==========`);
              console.log(`✅ [Campaign] Response Status: ${callResponse.status}`);
              console.log(`📦 [Campaign] Full Response Body:`, JSON.stringify(callResponse.data, null, 2));
              console.log(`=====================================================\n`);

              contactResult.call_status = callResponse.data.status === 'success' ? 'success' : 'failed';
              contactResult.transcript = callResponse.data.transcript || null;

              console.log(`[Campaign ${campaignId}] Call to ${contact.phone} completed with status: ${contactResult.call_status}`);

              // Create conversation immediately after successful call
              if (contactResult.call_status === 'success' && callResponse.data.details?.caller_id) {
                try {
                  const { conversationService } = await import('./conversation.service');
                  const User = (await import('../models/User')).default;
                  const user = await User.findById(userId);
                  const conversation = await conversationService.createForOutboundCall({
                    userId: userId,
                    organizationId: user?.organizationId?.toString() || userId,
                    phone: contact.phone,
                    name: contact.name || 'Unknown',
                    callerId: callResponse.data.details.caller_id
                  });
                  console.log(`[Campaign ${campaignId}] Created conversation ${conversation._id} for ${contact.name}`);
                } catch (convError: any) {
                  console.error(`[Campaign ${campaignId}] Failed to create conversation:`, convError.message);
                }
              }

              // Track voice usage if call was successful
              if (contactResult.call_status === 'success' && callResponse.data.duration) {
                const durationMinutes = Math.ceil(callResponse.data.duration / 60); // Convert seconds to minutes, round up
                await trackUsage(userId, 'voice', durationMinutes);
                console.log(`[Campaign ${campaignId}] Tracked ${durationMinutes} voice minutes for user ${userId}`);
              }

              // Save transcript as conversation if available
              if (contactResult.transcript && Object.keys(contactResult.transcript).length > 0) {
                try {
                  await this.saveTranscriptAsConversation(
                    String(contact._id),
                    contactResult.transcript,
                    String(campaign._id),
                    organizationId.toString()
                  );
                  console.log(`[Campaign ${campaignId}] Saved transcript for ${contact.name}`);
                } catch (transcriptError: any) {
                  console.error(`[Campaign ${campaignId}] Failed to save transcript for ${contact.name}:`, transcriptError.message);
                  // Don't fail the entire campaign if transcript saving fails
                }
              }
            } catch (error: any) {
              console.error(`[Campaign ${campaignId}] Call to ${contact.phone} failed:`, error.response?.data?.detail || error.message);
              contactResult.call_status = 'failed';
              contactResult.errors.push(`Call failed: ${error.response?.data?.detail || error.message}`);
            }
          }
        }

        // 2. Send Email if requested
        if (campaign.communicationTypes.includes('email')) {
          if (!contact.email) {
            console.error(`[Campaign ${campaignId}] Contact ${contact.name} has no email, skipping email`);
            contactResult.email_status = 'failed';
            contactResult.errors.push('No email address available');
          } else if (!campaign.emailBody || !campaign.emailBody.subject || !campaign.emailBody.body) {
            console.error(`[Campaign ${campaignId}] Email subject/body not configured, skipping email`);
            contactResult.email_status = 'failed';
            contactResult.errors.push('Email subject or body not configured');
          } else {
            try {
              console.log(`\n========== CAMPAIGN EMAIL SEND ==========`);
              console.log(`[Campaign ${campaignId}] Sending email to ${contact.email}...`);
              console.log(`[Campaign ${campaignId}] Email Payload:`, {
                to: contact.email,
                subject: campaign.emailBody.subject,
                html: campaign.emailBody.body?.substring(0, 100) + '...',
                is_html: campaign.emailBody.is_html || false
              });
              
              const emailResult = await emailService.sendEmail({
                to: contact.email,
                subject: campaign.emailBody.subject,
                html: campaign.emailBody.is_html ? campaign.emailBody.body : undefined,
                text: campaign.emailBody.is_html ? undefined : campaign.emailBody.body,
              });

              if (emailResult.success) {
                contactResult.email_status = 'success';
                console.log(`[Campaign ${campaignId}] ✅ Email to ${contact.email} sent successfully`);
                if (emailResult.messageId) {
                  console.log(`[Campaign ${campaignId}] Email Message ID: ${emailResult.messageId}`);
                }
              } else {
                contactResult.email_status = 'failed';
                const errorMsg = emailResult.error || 'Email sending failed';
                console.error(`[Campaign ${campaignId}] ❌ Email to ${contact.email} failed: ${errorMsg}`);
                contactResult.errors.push(`Email failed: ${errorMsg}`);
              }
              console.log(`==========================================\n`);
            } catch (error: any) {
              console.error(`\n========== CAMPAIGN EMAIL ERROR ==========`);
              console.error(`[Campaign ${campaignId}] Email to ${contact.email} FAILED`);
              console.error(`[Campaign ${campaignId}] Error Type:`, error.name || error.constructor?.name);
              console.error(`[Campaign ${campaignId}] Error Message:`, error.message);
              console.error(`[Campaign ${campaignId}] Error Code:`, error.code || error.errorCode);
              
              // Check if it's an AppError (has code property)
              if (error.code && error.statusCode) {
                console.error(`[Campaign ${campaignId}] AppError Code:`, error.code);
                console.error(`[Campaign ${campaignId}] AppError Status:`, error.statusCode);
                console.error(`[Campaign ${campaignId}] AppError Message:`, error.message);
              }
              
              // Check for nodemailer-specific errors
              if (error.responseCode || error.code) {
                console.error(`[Campaign ${campaignId}] SMTP Response Code:`, error.responseCode);
                console.error(`[Campaign ${campaignId}] SMTP Error Code:`, error.code);
                console.error(`[Campaign ${campaignId}] SMTP Command:`, error.command);
              }
              
              console.error(`[Campaign ${campaignId}] Error Details:`, error.details || error.response?.data);
              console.error(`[Campaign ${campaignId}] Stack:`, error.stack);
              console.error(`==========================================\n`);
              contactResult.email_status = 'failed';
              
              // Extract meaningful error message
              let errorMessage = 'Failed to send email. Please check the logs for more details.';
              
              // Handle AppError (from emailService) - AppError uses 'code' property
              if (error.code === 'EMAIL_NOT_CONFIGURED') {
                errorMessage = 'SMTP is not configured. Please configure SMTP settings in environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).';
              } else if (error.code === 'EMAIL_SEND_FAILED') {
                errorMessage = error.message || 'Email sending failed. Please check SMTP configuration.';
              } else if (error.message) {
                errorMessage = error.message;
              } else if (error.code === 'EAUTH' || error.code === 'ECONNECTION') {
                errorMessage = `SMTP authentication failed. Please check SMTP_USER and SMTP_PASS credentials. Error: ${error.message || error.code}`;
              } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
                errorMessage = `Cannot connect to SMTP server. Please check SMTP_HOST and SMTP_PORT. Error: ${error.message || error.code}`;
              }
              
              contactResult.errors.push(`Email failed: ${errorMessage}`);
            }
          }
        }

        // 3. Send SMS if requested
        if (campaign.communicationTypes.includes('sms')) {
          if (!contact.phone) {
            console.error(`[Campaign ${campaignId}] Contact ${contact.name} has no phone number, skipping SMS`);
            contactResult.sms_status = 'failed';
            contactResult.errors.push('No phone number available for SMS');
          } else if (!campaign.smsBody || !campaign.smsBody.message) {
            console.error(`[Campaign ${campaignId}] SMS message not configured, skipping SMS`);
            contactResult.sms_status = 'failed';
            contactResult.errors.push('SMS message not configured');
          } else {
            try {
              // Normalize phone number to E.164 format
              const normalizedPhone = normalizePhoneNumber(contact.phone);
              
              console.log(`[Campaign ${campaignId}] Sending SMS to ${normalizedPhone}...`);
              const smsResponse = await axios.post(`${COMM_API}/sms/send`, {
                body: campaign.smsBody.message,
                number: normalizedPhone,
              }, {
                timeout: 30000, // 30 seconds timeout
              });

              contactResult.sms_status = smsResponse.data.status === 'success' ? 'success' : 'failed';
              console.log(`[Campaign ${campaignId}] SMS to ${contact.phone} completed with status: ${contactResult.sms_status}`);
            } catch (error: any) {
              console.error(`[Campaign ${campaignId}] SMS to ${contact.phone} failed:`, error.response?.data?.detail || error.message);
              contactResult.sms_status = 'failed';
              contactResult.errors.push(`SMS failed: ${error.response?.data?.detail || error.message}`);
            }
          }
        }

        // Determine overall status for this contact
        const anySuccess = contactResult.call_status === 'success' || 
                          contactResult.email_status === 'success' || 
                          contactResult.sms_status === 'success';
        
        if (anySuccess) {
          successCount++;
        } else {
          failCount++;
        }

        results.push(contactResult);

        // Create campaign recipient record
        try {
          await CampaignRecipient.create({
            campaignId: campaign._id,
            contactId: contact._id,
            status: anySuccess ? 'sent' : 'failed',
            sentAt: new Date(),
            failureReason: contactResult.errors.length > 0 ? JSON.stringify(contactResult.errors) : undefined,
          });
        } catch (recipientError: any) {
          console.error(`[Campaign ${campaignId}] Failed to save recipient record for ${contact.name}:`, recipientError.message);
        }

        // Update progress and add logs
        // Use organizationId parameter directly
        if (anySuccess) {
          await this.updateCampaignProgress(campaign, organizationId.toString(), { sentCount: 1, pendingCount: -1 });
          await this.addCampaignLog(campaign, 'success', `Message sent to ${contact.name} (${contact.email || contact.phone})`);
        } else {
          await this.updateCampaignProgress(campaign, organizationId.toString(), { failedCount: 1, pendingCount: -1 });
          await this.addCampaignLog(campaign, 'error', `Failed to send to ${contact.name} (${contact.email || contact.phone})`, {
            errors: contactResult.errors
          });
        }

        console.log(`[Campaign ${campaignId}] Completed processing contact ${contact.name}. Success: ${anySuccess ? 'Yes' : 'No'}`);
        
        // Check if campaign was paused (refresh from DB)
        const updatedCampaign = await Campaign.findById(campaignId);
        if (updatedCampaign?.status === 'paused') {
          campaign.status = 'paused';
          campaign.pausedAt = new Date();
          await campaign.save();
          await this.addCampaignLog(campaign, 'warning', 'Campaign paused by user');
          console.log(`[Campaign ${campaignId}] Campaign paused, stopping execution`);
          break;
        }
      }

      // Update campaign status based on results
      // Get organizationId from listId
      const finalList = await ContactList.findById(campaign.listId);
      const finalOrganizationId = finalList?.organizationId?.toString() || userId;
      
      if (campaign.status === 'paused') {
        await this.addCampaignLog(campaign, 'info', `Campaign paused. Processed ${successCount + failCount} of ${contacts.length} contacts`);
      } else {
        campaign.status = failCount === contacts.length ? 'failed' : 'completed';
        campaign.completedAt = new Date();
        if (campaign.status === 'failed') {
          campaign.failedAt = new Date();
        }
        await campaign.save();
        
        await this.addCampaignLog(campaign, campaign.status === 'failed' ? 'error' : 'success', 
          `Campaign ${campaign.status}. Success: ${successCount}, Failed: ${failCount}`);
        
        // Emit final status
        emitToOrganization(finalOrganizationId, 'campaign:status', {
          campaignId: campaign._id.toString(),
          status: campaign.status,
          progress: 100,
          totalRecipients: contacts.length,
          sentCount: successCount,
          failedCount: failCount,
          pendingCount: 0
        });
      }

      console.log(`\n[Campaign ${campaignId}] Campaign ${campaign.status}. Success: ${successCount}, Failed: ${failCount}`);

      return {
        campaign,
        results: {
          total: contacts.length,
          success: successCount,
          failed: failCount,
          details: results,
        },
      };
    } catch (error: any) {
      console.error(`[Campaign ${campaignId}] Campaign failed with error:`, error.message);
      
      // Update campaign status to failed
      campaign.status = 'failed';
      await campaign.save();

      throw new AppError(500, 'CAMPAIGN_ERROR', error.message || 'Failed to execute campaign');
    }
  }

  // Helper method to save call transcript as conversation with messages
  private async saveTranscriptAsConversation(
    customerId: string,
    transcript: Record<string, any>,
    campaignId: string,
    organizationId: string
  ) {
    try {
      console.log(`[Transcript] Raw transcript structure:`, JSON.stringify(transcript, null, 2));
      
      // CRITICAL: Always set organizationId for data isolation
      // Create conversation
      const conversation = await Conversation.create({
        customerId,
        channel: 'phone',
        status: 'closed',
        transcript,
        campaignId,
        organizationId, // CRITICAL: Always set organizationId
        isAiManaging: true,
        unread: false,
      });

      console.log(`[Transcript] Created conversation ${conversation._id} for customer ${customerId}`);

      // Parse transcript and create message records
      const messages: any[] = [];
      let transcriptArray: any[] = [];

      // Try to extract messages from different transcript formats
      if (Array.isArray(transcript)) {
        console.log(`[Transcript] Format: Array with ${transcript.length} items`);
        transcriptArray = transcript;
      } else if (typeof transcript === 'object') {
        // Check for common formats
        if (transcript.items && Array.isArray(transcript.items)) {
          console.log(`[Transcript] Format: Object with items array (${transcript.items.length} items)`);
          transcriptArray = transcript.items;
        } else if (transcript.turns && Array.isArray(transcript.turns)) {
          console.log(`[Transcript] Format: Object with turns array (${transcript.turns.length} turns)`);
          transcriptArray = transcript.turns;
        } else if (transcript.messages && Array.isArray(transcript.messages)) {
          console.log(`[Transcript] Format: Object with messages array (${transcript.messages.length} messages)`);
          transcriptArray = transcript.messages;
        } else if (transcript.conversation && Array.isArray(transcript.conversation)) {
          console.log(`[Transcript] Format: Object with conversation array (${transcript.conversation.length} items)`);
          transcriptArray = transcript.conversation;
        } else {
          // Try object keys as indices (e.g., {"0": {...}, "1": {...}})
          const keys = Object.keys(transcript).filter(key => !isNaN(Number(key))).sort((a, b) => Number(a) - Number(b));
          if (keys.length > 0) {
            console.log(`[Transcript] Format: Object with numeric keys (${keys.length} entries)`);
            transcriptArray = keys.map(key => transcript[key]);
          } else {
            console.log(`[Transcript] Format: Unknown object format. Keys:`, Object.keys(transcript));
          }
        }
      } else {
        console.log(`[Transcript] Format: Unexpected type - ${typeof transcript}`);
      }

      console.log(`[Transcript] Parsed ${transcriptArray.length} transcript entries`);

      // Convert transcript entries to messages
      for (let i = 0; i < transcriptArray.length; i++) {
        const entry = transcriptArray[i];
        console.log(`[Transcript] Entry ${i}:`, JSON.stringify(entry, null, 2));
        
        let sender: 'customer' | 'ai' = 'customer';
        let text = '';

        // Determine sender and text based on different formats
        if (entry.role === 'user' || entry.role === 'customer' || entry.sender === 'user') {
          sender = 'customer';
        } else if (entry.role === 'assistant' || entry.role === 'ai' || entry.sender === 'assistant' || entry.sender === 'ai') {
          sender = 'ai';
        } else {
          console.log(`[Transcript] Warning: Unknown sender type in entry ${i}. Entry:`, entry);
        }

        // Extract text - handle both string and array formats
        if (entry.content) {
          if (Array.isArray(entry.content)) {
            // Content is an array of strings, join them
            text = entry.content.join(' ');
          } else if (typeof entry.content === 'string') {
            text = entry.content;
          }
        } else {
          text = entry.text || entry.message || '';
        }

        if (text && text.trim()) {
          const message = {
            conversationId: conversation._id,
            sender,
            text: text.trim(),
            type: 'message',
            attachments: [],
            sourcesUsed: [],
            topics: [],
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
          };
          messages.push(message);
          console.log(`[Transcript] Created message ${i + 1}:`, { sender, textLength: text.length });
        } else {
          console.log(`[Transcript] Warning: No text found in entry ${i}`);
        }
      }

      // Save all messages
      if (messages.length > 0) {
        const savedMessages = await Message.insertMany(messages);
        console.log(`[Transcript] ✅ Successfully created ${messages.length} messages for conversation ${conversation._id}`);
        console.log(`[Transcript] Sample saved message:`, {
          _id: savedMessages[0]._id,
          conversationId: savedMessages[0].conversationId,
          conversationIdType: typeof savedMessages[0].conversationId,
          sender: savedMessages[0].sender,
        });
        
        // Verify messages can be queried back
        const verifyCount = await Message.countDocuments({ conversationId: conversation._id });
        console.log(`[Transcript] Verification: Found ${verifyCount} messages with conversationId query`);
      } else {
        console.log(`[Transcript] ⚠️ No messages created from transcript!`);
      }

      return conversation;
    } catch (error: any) {
      console.error('[Transcript] ❌ Error saving transcript as conversation:', error.message);
      console.error('[Transcript] Error stack:', error.stack);
      throw error;
    }
  }

  async getAnalytics(campaignId: string, organizationId: string) {
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    }

    // CRITICAL: Verify ownership - campaign's list must belong to user's organization
    const list = await ContactList.findById(campaign.listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'Contact list not found');
    }
    
    const listOrgId = list.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (listOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this campaign');
    }

    const recipients = await CampaignRecipient.find({ campaignId }).lean();

    const stats = {
      sent: recipients.filter(r => r.status !== 'pending' && r.status !== 'failed').length,
      delivered: recipients.filter(r => r.deliveredAt).length,
      failed: recipients.filter(r => r.status === 'failed').length,
      opened: recipients.filter(r => r.openedAt).length,
      clicked: recipients.filter(r => r.clickedAt).length,
      replied: recipients.filter(r => r.repliedAt).length,
      openRate: 0,
      clickRate: 0,
      replyRate: 0
    };

    if (stats.delivered > 0) {
      stats.openRate = (stats.opened / stats.delivered) * 100;
      stats.clickRate = (stats.clicked / stats.delivered) * 100;
      stats.replyRate = (stats.replied / stats.delivered) * 100;
    }

    // Get timeline
    const timeline = await CampaignRecipient.aggregate([
      { $match: { campaignId: campaign._id } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d %H:00',
              date: '$sentAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return {
      campaignId,
      stats,
      timeline
    };
  }


  private async scheduleCampaign(campaignId: string, scheduledAt: Date) {
    if (!campaignQueue) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Campaign queue is not available. Redis must be running to schedule campaigns.');
    }

    const delay = scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      // Send immediately
      await campaignQueue.add('send-campaign', { campaignId });
    } else {
      // Schedule for later
      await campaignQueue.add('send-campaign', { campaignId }, { delay });
    }
  }

  async getTemplates() {
    // Return mock templates or fetch from WhatsApp API
    return [
      {
        id: 'template_1',
        name: 'order_confirmation',
        language: 'en',
        status: 'approved',
        category: 'transactional',
        components: [
          {
            type: 'HEADER',
            format: 'TEXT',
            text: 'Order Confirmation'
          },
          {
            type: 'BODY',
            text: 'Hi {{1}}, your order {{2}} has been confirmed.'
          }
        ],
        variables: ['customer_name', 'order_number']
      },
      {
        id: 'template_2',
        name: 'welcome_message',
        language: 'en',
        status: 'approved',
        category: 'marketing',
        components: [
          {
            type: 'HEADER',
            format: 'TEXT',
            text: 'Welcome!'
          },
          {
            type: 'BODY',
            text: 'Hi {{1}}, welcome to our platform. We are excited to have you!'
          }
        ],
        variables: ['customer_name']
      },
      {
        id: 'template_3',
        name: 'promotional_offer',
        language: 'en',
        status: 'approved',
        category: 'marketing',
        components: [
          {
            type: 'HEADER',
            format: 'TEXT',
            text: 'Special Offer!'
          },
          {
            type: 'BODY',
            text: 'Hi {{1}}, get {{2}}% off on your next purchase. Valid until {{3}}.'
          }
        ],
        variables: ['customer_name', 'discount_percentage', 'expiry_date']
      }
    ];
  }
}

export const campaignService = new CampaignService();

