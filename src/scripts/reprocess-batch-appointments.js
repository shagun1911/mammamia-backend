// Script to manually re-trigger batch call automation for existing conversations
const mongoose = require('mongoose');
require('dotenv').config();

const ConversationSchema = new mongoose.Schema({}, { strict: false });
const Conversation = mongoose.model('Conversation', ConversationSchema);

async function reprocessBatchAppointments() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find recent batch call conversations (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const batchConversations = await Conversation.find({
      'metadata.source': 'batch',
      'metadata.batch_call_id': { $exists: true },
      transcript: { $exists: true },
      createdAt: { $gte: oneDayAgo }
    }).select('_id metadata organizationId userId customerId').lean();

    console.log(`Found ${batchConversations.length} batch call conversations to reprocess\n`);

    if (batchConversations.length === 0) {
      console.log('No conversations to process. Exiting.');
      process.exit(0);
    }

    // Import automation service
    const { automationService } = require('../../dist/services/automation.service');

    let processed = 0;
    let failed = 0;

    for (const conv of batchConversations) {
      try {
        console.log(`Processing conversation: ${conv._id}`);
        console.log(`  - Batch ID: ${conv.metadata?.batch_call_id}`);
        console.log(`  - Organization: ${conv.organizationId}`);

        // Get customerId - try from conv.customerId first, then metadata
        const customerId = conv.customerId?.toString() || conv.metadata?.customerId?.toString();
        
        if (!customerId) {
          console.log(`  ⚠️  No customerId found, skipping...\n`);
          failed++;
          continue;
        }

        // Trigger the batch_call_completed event manually
        await automationService.triggerByEvent('batch_call_completed', {
          event: 'batch_call_completed',
          batch_id: conv.metadata?.batch_call_id,
          conversation_id: conv._id.toString(),
          contactId: customerId,
          organizationId: conv.organizationId?.toString(),
          source: 'manual_reprocess'
        }, {
          userId: conv.userId?.toString(),
          organizationId: conv.organizationId?.toString()
        });

        console.log(`  ✅ Automation triggered\n`);
        processed++;

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`  ❌ Failed to process ${conv._id}:`, error.message, '\n');
        failed++;
      }
    }

    console.log('\n========================================');
    console.log('REPROCESSING COMPLETE');
    console.log('========================================');
    console.log(`✅ Processed: ${processed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${batchConversations.length}`);
    console.log('========================================\n');
    console.log('Check your backend logs for automation execution results!');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

reprocessBatchAppointments();
