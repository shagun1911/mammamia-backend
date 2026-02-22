import Bull from 'bull';
import Campaign from '../models/Campaign';
import CampaignRecipient from '../models/CampaignRecipient';
import ContactListMember from '../models/ContactListMember';
import Customer from '../models/Customer';
import { WhatsAppService } from '../services/whatsapp.service';
import { isRedisAvailable, bullCreateClient } from '../config/redis';

let campaignQueue: Bull.Queue | null = null;

const createQueueIfAvailable = () => {
  if (!isRedisAvailable() || !process.env.REDIS_URL) {
    console.log('[Campaign Queue] ⚠️  Redis not available - queue not created');
    campaignQueue = null;
    return;
  }
  try {
    campaignQueue = new Bull('campaign', { createClient: bullCreateClient });
    campaignQueue.on('error', (error) => {
      console.error('[Campaign Queue] ❌ Queue connection error:', error.message);
    });
    console.log('[Campaign Queue] ✅ Queue created successfully');
    setupQueueProcessors();
  } catch (error: any) {
    console.log('[Campaign Queue] ⚠️  Queue creation failed:', error.message);
    campaignQueue = null;
  }
};

setTimeout(() => { createQueueIfAvailable(); }, 3000);

export { campaignQueue };

const whatsappService = new WhatsAppService();

const setupQueueProcessors = () => {
  if (!campaignQueue) return;

  campaignQueue!.process('send-campaign', async (job) => {
    const { campaignId } = job.data;

    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) return;

      campaign.status = 'running';
      await campaign.save();

      const members = await ContactListMember.find({ listId: campaign.listId });
      const contactIds = members.map(m => m.contactId);
      const contacts = await Customer.find({ _id: { $in: contactIds } });

      const recipients = contacts.map(contact => ({
        campaignId: campaign._id,
        contactId: contact._id,
        status: 'pending'
      }));
      await CampaignRecipient.insertMany(recipients);

      for (const contact of contacts) {
        if (!contact.phone) continue;
        try {
          const variables: Record<string, string> = {};
          if (campaign.templateVariables) {
            for (const [key, value] of Object.entries(campaign.templateVariables)) {
              variables[key] = value.replace('{{name}}', contact.name);
            }
          }
          const { messageId } = await whatsappService.sendTemplate(contact.phone, campaign.templateId!, 'en', variables);
          await CampaignRecipient.findOneAndUpdate(
            { campaignId: campaign._id, contactId: contact._id },
            { status: 'sent', messageId, sentAt: new Date() }
          );
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          console.error(`Failed to send to ${contact.phone}:`, error.message);
          await CampaignRecipient.findOneAndUpdate(
            { campaignId: campaign._id, contactId: contact._id },
            { status: 'failed', failedAt: new Date(), failureReason: error.message }
          );
        }
      }

      campaign.status = 'completed';
      campaign.sentAt = new Date();
      await campaign.save();

      if (campaignQueue) {
        for (const followUp of campaign.followUps) {
          const delayMs = calculateDelay(followUp.delay, followUp.delayUnit);
          await campaignQueue.add('send-follow-up', { campaignId: campaign._id, followUpId: (followUp as any)._id }, { delay: delayMs });
        }
      }
    } catch (error: any) {
      console.error('Campaign sending error:', error);
      const campaign = await Campaign.findById(campaignId);
      if (campaign) { campaign.status = 'failed'; await campaign.save(); }
    }
  });

  campaignQueue!.process('send-follow-up', async (job) => {
    const { campaignId, followUpId } = job.data;
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) return;
      const followUp = campaign.followUps.find((f: any) => f._id.toString() === followUpId);
      if (!followUp) return;

      let recipients;
      if (followUp.condition === 'if_no_response') {
        recipients = await CampaignRecipient.find({ campaignId, status: { $in: ['sent', 'delivered', 'read'] }, repliedAt: { $exists: false } }).populate('contactId');
      } else {
        recipients = await CampaignRecipient.find({ campaignId, status: { $in: ['sent', 'delivered', 'read'] } }).populate('contactId');
      }

      for (const recipient of recipients) {
        const contact = recipient.contactId as any;
        if (!contact || !contact.phone) continue;
        try {
          const variables: Record<string, string> = {};
          if (campaign.templateVariables) {
            for (const [key, value] of Object.entries(campaign.templateVariables)) {
              variables[key] = value.replace('{{name}}', contact.name);
            }
          }
          await whatsappService.sendTemplate(contact.phone, followUp.templateId, 'en', variables);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          console.error(`Failed to send follow-up to ${contact.phone}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('Follow-up sending error:', error);
    }
  });
};

function calculateDelay(delay: number, unit: string): number {
  const multipliers: Record<string, number> = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000
  };

  return delay * (multipliers[unit] || 0);
}

