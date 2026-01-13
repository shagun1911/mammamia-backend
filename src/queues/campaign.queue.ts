import Bull from 'bull';
import Campaign from '../models/Campaign';
import CampaignRecipient from '../models/CampaignRecipient';
import ContactListMember from '../models/ContactListMember';
import Customer from '../models/Customer';
import { WhatsAppService } from '../services/whatsapp.service';

// Create campaign queue (will fail gracefully if Redis is unavailable)
let campaignQueue: Bull.Queue | null = null;

try {
  campaignQueue = new Bull('campaign', process.env.REDIS_URL!);
} catch (error) {
  console.log('⚠ Campaign queue unavailable - Redis not connected');
}

export { campaignQueue };

const whatsappService = new WhatsAppService();

// Process campaign sending (only if queue is available)
if (campaignQueue) {
  campaignQueue.process('send-campaign', async (job) => {
    const { campaignId } = job.data;

  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;

    // Update status
    campaign.status = 'sending';
    await campaign.save();

    // Get all contacts from the list
    const members = await ContactListMember.find({ listId: campaign.listId });
    const contactIds = members.map(m => m.contactId);
    const contacts = await Customer.find({ _id: { $in: contactIds } });

    // Create recipient records
    const recipients = contacts.map(contact => ({
      campaignId: campaign._id,
      contactId: contact._id,
      status: 'pending'
    }));

    await CampaignRecipient.insertMany(recipients);

    // Send messages with rate limiting
    for (const contact of contacts) {
      if (!contact.phone) continue;

      try {
        // Replace template variables
        const variables: Record<string, string> = {};
        if (campaign.templateVariables) {
          for (const [key, value] of Object.entries(campaign.templateVariables)) {
            variables[key] = value.replace('{{name}}', contact.name);
          }
        }

        // Send via WhatsApp
        const { messageId } = await whatsappService.sendTemplate(
          contact.phone,
          campaign.templateId!,
          'en',
          variables
        );

        // Update recipient
        await CampaignRecipient.findOneAndUpdate(
          { campaignId: campaign._id, contactId: contact._id },
          {
            status: 'sent',
            messageId,
            sentAt: new Date()
          }
        );

        // Rate limiting: wait 1 second between messages
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`Failed to send to ${contact.phone}:`, error.message);
        
        await CampaignRecipient.findOneAndUpdate(
          { campaignId: campaign._id, contactId: contact._id },
          {
            status: 'failed',
            failedAt: new Date(),
            failureReason: error.message
          }
        );
      }
    }

    // Update campaign status
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    await campaign.save();

    // Schedule follow-ups (only if queue is available)
    if (campaignQueue) {
      for (const followUp of campaign.followUps) {
        const delayMs = calculateDelay(followUp.delay, followUp.delayUnit);
        await campaignQueue.add(
          'send-follow-up',
          {
            campaignId: campaign._id,
            followUpId: (followUp as any)._id
          },
          { delay: delayMs }
        );
      }
    }

  } catch (error: any) {
    console.error('Campaign sending error:', error);
    
    const campaign = await Campaign.findById(campaignId);
    if (campaign) {
      campaign.status = 'failed';
      await campaign.save();
    }
  }
});

// Process follow-up sending
campaignQueue.process('send-follow-up', async (job) => {
  const { campaignId, followUpId } = job.data;

  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;

    const followUp = campaign.followUps.find((f: any) => f._id.toString() === followUpId);
    if (!followUp) return;

    // Get recipients based on condition
    let recipients;
    if (followUp.condition === 'if_no_response') {
      // Only send to recipients who haven't replied
      recipients = await CampaignRecipient.find({
        campaignId,
        status: { $in: ['sent', 'delivered', 'read'] },
        repliedAt: { $exists: false }
      }).populate('contactId');
    } else {
      // Send to all successful recipients
      recipients = await CampaignRecipient.find({
        campaignId,
        status: { $in: ['sent', 'delivered', 'read'] }
      }).populate('contactId');
    }

    // Send follow-up messages
    for (const recipient of recipients) {
      const contact = recipient.contactId as any;
      if (!contact || !contact.phone) continue;

      try {
        // Replace template variables
        const variables: Record<string, string> = {};
        if (campaign.templateVariables) {
          for (const [key, value] of Object.entries(campaign.templateVariables)) {
            variables[key] = value.replace('{{name}}', contact.name);
          }
        }

        // Send via WhatsApp
        await whatsappService.sendTemplate(
          contact.phone,
          followUp.templateId,
          'en',
          variables
        );

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`Failed to send follow-up to ${contact.phone}:`, error.message);
      }
    }

  } catch (error: any) {
    console.error('Follow-up sending error:', error);
  }
  });
}

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

