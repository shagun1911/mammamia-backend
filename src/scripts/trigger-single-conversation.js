// Trigger automation for a single conversation
const mongoose = require('mongoose');
require('dotenv').config();

async function triggerSingleConversation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const { automationService } = require('../../dist/services/automation.service');

    const conversationId = '69808d0447bb3c52a9efb373'; // Your latest conversation
    const customerId = '69804f1a8c37a84940811c3a'; // The customer for this conversation
    const organizationId = '6980447153408e6b2ca3f09b';
    const batchId = 'btcal_0701kgf2aaa9ewxrspag2thjdnxn';

    console.log('Triggering automation for conversation:', conversationId);
    console.log('Customer ID:', customerId);
    console.log('Organization ID:', organizationId);
    console.log('Batch ID:', batchId);
    console.log('');

    await automationService.triggerByEvent('batch_call_completed', {
      event: 'batch_call_completed',
      batch_id: batchId,
      conversation_id: conversationId,
      contactId: customerId,
      organizationId: organizationId,
      source: 'manual_test'
    }, {
      userId: organizationId, // Using org as user for now
      organizationId: organizationId
    });

    console.log('\n✅ Automation triggered successfully!');
    console.log('Check backend logs for execution details...\n');

    // Wait a bit for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Done! Check:');
    console.log('1. Backend logs for extraction and calendar creation');
    console.log('2. Google Calendar for the event');
    console.log('3. Google Sheets for the log entry');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

triggerSingleConversation();
