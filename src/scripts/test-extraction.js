// Test extraction with conversation ID
const mongoose = require('mongoose');
require('dotenv').config();

async function testExtraction() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const { automationService } = require('../../dist/services/automation.service');

    // Test with the most recent conversation that has appointment data
    const conversationId = '69808d0447bb3c52a9efb373'; // The one from latest batch call
    const organizationId = '6980447153408e6b2ca3f09b';

    console.log(`\nTesting extraction for conversation: ${conversationId}\n`);

    const result = await automationService.extractConversationData(
      conversationId,
      'appointment',
      organizationId
    );

    console.log('\n========================================');
    console.log('EXTRACTION RESULT:');
    console.log('========================================');
    console.log(JSON.stringify(result, null, 2));
    console.log('========================================\n');

    if (result.appointment_booked) {
      console.log('✅ Appointment detected!');
      console.log(`   Date: ${result.date}`);
      console.log(`   Time: ${result.time}`);
      console.log(`   Confidence: ${result.confidence}`);
    } else {
      console.log('❌ No appointment detected');
      console.log(`   Reason: ${result.error || 'Not booked'}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testExtraction();
