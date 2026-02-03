/**
 * Fix Phone Number Flags Script
 * Updates existing Twilio phone numbers to be outbound-only
 * Specifically fixes +14789002879 which was incorrectly set to support both inbound and outbound
 */

const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot-platform';

async function fixPhoneNumberFlags() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get PhoneNumber model
    const PhoneNumber = mongoose.model('PhoneNumber', new mongoose.Schema({}, { strict: false }));

    // Find the specific phone number
    const phoneNumber = '+14789002879';
    console.log(`\n🔍 Looking for phone number: ${phoneNumber}`);

    const existingNumber = await PhoneNumber.findOne({ phone_number: phoneNumber });

    if (!existingNumber) {
      console.log(`❌ Phone number ${phoneNumber} not found in database`);
      process.exit(0);
    }

    console.log(`\n📞 Found phone number:`);
    console.log(`   ID: ${existingNumber.phone_number_id}`);
    console.log(`   Label: ${existingNumber.label}`);
    console.log(`   Provider: ${existingNumber.provider}`);
    console.log(`   Current supports_outbound: ${existingNumber.supports_outbound}`);
    console.log(`   Current supports_inbound: ${existingNumber.supports_inbound}`);

    // Check if it's a Twilio number (Full Setup)
    if (existingNumber.provider === 'twilio') {
      console.log(`\n🔄 Updating phone number to be outbound-only (Full Setup behavior)...`);
      
      const result = await PhoneNumber.updateOne(
        { phone_number: phoneNumber },
        { 
          $set: { 
            supports_outbound: true,
            supports_inbound: false 
          } 
        }
      );

      console.log(`✅ Update result:`, result);

      // Verify the update
      const updatedNumber = await PhoneNumber.findOne({ phone_number: phoneNumber });
      console.log(`\n✅ Updated phone number:`);
      console.log(`   supports_outbound: ${updatedNumber.supports_outbound}`);
      console.log(`   supports_inbound: ${updatedNumber.supports_inbound}`);
      
      console.log(`\n🎉 Successfully updated ${phoneNumber} to be outbound-only!`);
      console.log(`   This number will now appear ONLY in the Outbound section.`);
    } else {
      console.log(`\nℹ️  This is a ${existingNumber.provider} number (not Twilio)`);
      console.log(`   Skipping update as this script is only for Twilio Full Setup numbers`);
    }

    // Also fix any other Twilio numbers that have both flags set
    console.log(`\n🔍 Checking for other Twilio numbers with both flags set...`);
    const otherTwilioNumbers = await PhoneNumber.find({
      provider: 'twilio',
      supports_outbound: true,
      supports_inbound: true,
      phone_number: { $ne: phoneNumber } // Exclude the one we just fixed
    });

    if (otherTwilioNumbers.length > 0) {
      console.log(`\n📋 Found ${otherTwilioNumbers.length} other Twilio number(s) with both flags:`);
      otherTwilioNumbers.forEach(num => {
        console.log(`   - ${num.phone_number} (${num.label})`);
      });

      console.log(`\n🔄 Updating all Twilio numbers to be outbound-only...`);
      const bulkResult = await PhoneNumber.updateMany(
        {
          provider: 'twilio',
          supports_outbound: true,
          supports_inbound: true
        },
        {
          $set: { supports_inbound: false }
        }
      );

      console.log(`✅ Updated ${bulkResult.modifiedCount} additional Twilio number(s)`);
    } else {
      console.log(`✅ No other Twilio numbers found with both flags set`);
    }

    console.log(`\n✨ All done! Your phone numbers are now correctly configured.`);
    console.log(`\n📋 Summary:`);
    console.log(`   - Full Setup (Twilio) numbers: Outbound-only`);
    console.log(`   - Generic Setup numbers: As configured (can be inbound, outbound, or both)`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
fixPhoneNumberFlags();
