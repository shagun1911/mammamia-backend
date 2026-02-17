/**
 * Show which user accounts have working Instagram/Facebook integrations
 */

const mongoose = require('mongoose');
require('dotenv').config();

const SocialIntegrationSchema = new mongoose.Schema({}, { strict: false });
const SocialIntegration = mongoose.model('SocialIntegration', SocialIntegrationSchema);

const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema);

async function main() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const expectedFacebookPageId = '1006770519175890';
    const expectedInstagramAccountId = '17841480066717301';

    // Find all working Instagram integrations
    const workingInstagram = await SocialIntegration.find({
      'credentials.instagramAccountId': expectedInstagramAccountId,
      platform: 'instagram',
      status: 'connected',
      userId: { $exists: true, $ne: null }
    }).lean();

    // Find all working Facebook integrations
    const workingFacebook = await SocialIntegration.find({
      'credentials.facebookPageId': expectedFacebookPageId,
      platform: 'facebook',
      status: 'connected',
      userId: { $exists: true, $ne: null }
    }).lean();

    console.log('========================================');
    console.log('✅ WORKING INSTAGRAM INTEGRATIONS');
    console.log('========================================\n');
    
    if (workingInstagram.length === 0) {
      console.log('❌ NO WORKING INSTAGRAM INTEGRATIONS FOUND!');
      console.log('   The webhook requires userId to be set.');
      console.log('   Please reconnect Instagram from your account.\n');
    } else {
      for (const integration of workingInstagram) {
        console.log(`Integration ID: ${integration._id}`);
        console.log(`Status: ${integration.status}`);
        console.log(`UserId: ${integration.userId}`);
        console.log(`OrganizationId: ${integration.organizationId}`);
        
        // Try to find user details
        const user = await User.findById(integration.userId).lean();
        if (user) {
          console.log(`User Email: ${user.email || 'N/A'}`);
          console.log(`User Name: ${user.name || 'N/A'}`);
        } else {
          console.log(`User: NOT FOUND (user might have been deleted)`);
        }
        console.log('');
      }
    }

    console.log('========================================');
    console.log('✅ WORKING FACEBOOK INTEGRATIONS');
    console.log('========================================\n');
    
    if (workingFacebook.length === 0) {
      console.log('❌ NO WORKING FACEBOOK INTEGRATIONS FOUND!');
      console.log('   The webhook requires userId to be set.');
      console.log('   Please reconnect Facebook from your account.\n');
    } else {
      for (const integration of workingFacebook) {
        console.log(`Integration ID: ${integration._id}`);
        console.log(`Status: ${integration.status}`);
        console.log(`UserId: ${integration.userId}`);
        console.log(`OrganizationId: ${integration.organizationId}`);
        
        // Try to find user details
        const user = await User.findById(integration.userId).lean();
        if (user) {
          console.log(`User Email: ${user.email || 'N/A'}`);
          console.log(`User Name: ${user.name || 'N/A'}`);
        } else {
          console.log(`User: NOT FOUND (user might have been deleted)`);
        }
        console.log('');
      }
    }

    // Find broken integrations (missing userId)
    const brokenInstagram = await SocialIntegration.find({
      'credentials.instagramAccountId': expectedInstagramAccountId,
      platform: 'instagram',
      status: 'connected',
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    }).lean();

    const brokenFacebook = await SocialIntegration.find({
      'credentials.facebookPageId': expectedFacebookPageId,
      platform: 'facebook',
      status: 'connected',
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    }).lean();

    if (brokenInstagram.length > 0 || brokenFacebook.length > 0) {
      console.log('========================================');
      console.log('⚠️  BROKEN INTEGRATIONS (Missing userId)');
      console.log('========================================\n');
      console.log(`These integrations exist but won't work because userId is missing:`);
      console.log(`- ${brokenInstagram.length} Instagram integration(s)`);
      console.log(`- ${brokenFacebook.length} Facebook integration(s)`);
      console.log('\nThese integrations will be ignored by the webhook handler.');
      console.log('You should delete these from the database or reconnect them.\n');
    }

    console.log('========================================');
    console.log('📝 INSTRUCTIONS');
    console.log('========================================\n');
    
    if (workingInstagram.length > 0 || workingFacebook.length > 0) {
      console.log('✅ You have working integrations!');
      console.log('\n👉 To test Instagram/Facebook messaging:');
      console.log('   1. Log in to your platform with the email shown above');
      console.log('   2. Send a message from Instagram/Facebook to your page');
      console.log('   3. Check the backend logs for webhook processing\n');
    } else {
      console.log('❌ NO working integrations found!');
      console.log('\n👉 To fix this:');
      console.log('   1. Log in to your platform');
      console.log('   2. Go to Integrations');
      console.log('   3. Disconnect and reconnect Instagram/Facebook');
      console.log('   4. Make sure you complete the full OAuth flow');
      console.log('   5. The system will automatically set userId during OAuth\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

main();
