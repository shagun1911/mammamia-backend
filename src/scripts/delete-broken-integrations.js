/**
 * Delete broken integrations and instructions for reconnecting
 */

const mongoose = require('mongoose');
const readline = require('readline');
require('dotenv').config();

const SocialIntegrationSchema = new mongoose.Schema({}, { strict: false });
const SocialIntegration = mongoose.model('SocialIntegration', SocialIntegrationSchema);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const expectedFacebookPageId = '1006770519175890';
    const expectedInstagramAccountId = '17841480066717301';

    // Find broken integrations
    const brokenIntegrations = await SocialIntegration.find({
      $or: [
        {
          'credentials.instagramAccountId': expectedInstagramAccountId,
          platform: 'instagram'
        },
        {
          'credentials.facebookPageId': expectedFacebookPageId,
          platform: 'facebook'
        }
      ],
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    }).lean();

    console.log('========================================');
    console.log('🗑️  BROKEN INTEGRATIONS TO DELETE');
    console.log('========================================\n');
    
    if (brokenIntegrations.length === 0) {
      console.log('✅ No broken integrations found! Everything looks good.');
      await mongoose.disconnect();
      rl.close();
      return;
    }

    console.log(`Found ${brokenIntegrations.length} broken integration(s):\n`);
    
    brokenIntegrations.forEach((integration, index) => {
      console.log(`${index + 1}. ${integration.platform.toUpperCase()}`);
      console.log(`   ID: ${integration._id}`);
      console.log(`   Status: ${integration.status}`);
      console.log(`   OrganizationId: ${integration.organizationId}`);
      console.log(`   userId: ${integration.userId || 'MISSING (This is the problem!)'}`);
      console.log('');
    });

    const answer = await question('Do you want to DELETE these broken integrations? (yes/no): ');
    
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
      const ids = brokenIntegrations.map(i => i._id);
      const result = await SocialIntegration.deleteMany({ _id: { $in: ids } });
      console.log(`\n✅ Deleted ${result.deletedCount} integration(s)\n`);
      
      console.log('========================================');
      console.log('📋 NEXT STEPS');
      console.log('========================================\n');
      console.log('1. Log in to your platform (your actual user account)');
      console.log('2. Go to Integrations page');
      console.log('3. Click "Connect Instagram" or "Connect Facebook"');
      console.log('4. Complete the OAuth flow');
      console.log('5. The system will automatically create a new integration WITH userId\n');
      console.log('Then try sending a message again - it should work! 🎉\n');
    } else {
      console.log('\n❌ Deletion cancelled. No changes made.\n');
      console.log('⚠️  WARNING: These broken integrations will continue to exist');
      console.log('   but they will NOT work because they are missing userId.\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    rl.close();
  }
}

main();
