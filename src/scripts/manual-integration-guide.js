/**
 * Quick Manual Integration Test
 * 
 * This script will show you exactly what to enter in your manual integration form
 * and test if the integration will work.
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  console.log('========================================');
  console.log('📝 MANUAL INTEGRATION INSTRUCTIONS');
  console.log('========================================\n');

  console.log('✅ Your new credentials from Graph API Explorer:\n');
  console.log('Facebook Page ID: 1006770519175890');
  console.log('Instagram Account ID: 17841480066717301');
  console.log('Access Token: (from Graph API Explorer - the User token you generated)\n');

  console.log('========================================');
  console.log('📋 HOW TO USE MANUAL INTEGRATION');
  console.log('========================================\n');

  console.log('🔧 BACKEND FIX APPLIED:');
  console.log('   The backend now accepts "pageAccessToken" field');
  console.log('   OR uses the apiKey as pageAccessToken for Instagram/Facebook\n');

  console.log('📝 OPTION 1: If your form has 3 fields (apiKey, instagramAccountId, facebookPageId)');
  console.log('   Enter:');
  console.log('   - API Key: <Your Access Token from Graph API Explorer>');
  console.log('   - Instagram Account ID: 17841480066717301');
  console.log('   - Facebook Page ID: 1006770519175890\n');

  console.log('   ✅ The backend will automatically use apiKey as pageAccessToken\n');

  console.log('📝 OPTION 2: If your form has a pageAccessToken field');
  console.log('   Enter:');
  console.log('   - API Key: <Your Access Token>');
  console.log('   - Instagram Account ID: 17841480066717301');
  console.log('   - Facebook Page ID: 1006770519175890');
  console.log('   - Page Access Token: <Same Access Token>\n');

  console.log('========================================');
  console.log('🧪 TESTING EXISTING INTEGRATIONS');
  console.log('========================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const SocialIntegrationSchema = new mongoose.Schema({}, { strict: false });
    const SocialIntegration = mongoose.model('SocialIntegration', SocialIntegrationSchema);

    const expectedFacebookPageId = '1006770519175890';
    const expectedInstagramAccountId = '17841480066717301';

    // Find integrations with matching IDs
    const instagramIntegrations = await SocialIntegration.find({
      'credentials.instagramAccountId': expectedInstagramAccountId,
      platform: 'instagram',
      status: 'connected'
    }).lean();

    const facebookIntegrations = await SocialIntegration.find({
      'credentials.facebookPageId': expectedFacebookPageId,
      platform: 'facebook',
      status: 'connected'
    }).lean();

    console.log('📊 CURRENT STATE:\n');
    console.log(`Instagram integrations: ${instagramIntegrations.length}`);
    console.log(`Facebook integrations: ${facebookIntegrations.length}\n`);

    // Check which ones have pageAccessToken
    const instagramWithToken = instagramIntegrations.filter(i => i.credentials?.pageAccessToken);
    const facebookWithToken = facebookIntegrations.filter(i => i.credentials?.pageAccessToken);

    console.log(`✅ Instagram with pageAccessToken: ${instagramWithToken.length}`);
    console.log(`✅ Facebook with pageAccessToken: ${facebookWithToken.length}\n`);

    // Check which ones have userId
    const instagramWithUser = instagramIntegrations.filter(i => i.userId);
    const facebookWithUser = facebookIntegrations.filter(i => i.userId);

    console.log(`✅ Instagram with userId: ${instagramWithUser.length}`);
    console.log(`✅ Facebook with userId: ${facebookWithUser.length}\n`);

    // Find fully working integrations (has both userId and pageAccessToken)
    const workingInstagram = instagramIntegrations.filter(i => i.userId && i.credentials?.pageAccessToken);
    const workingFacebook = facebookIntegrations.filter(i => i.userId && i.credentials?.pageAccessToken);

    console.log('========================================');
    console.log('✅ FULLY WORKING INTEGRATIONS');
    console.log('========================================\n');
    
    if (workingInstagram.length === 0 && workingFacebook.length === 0) {
      console.log('❌ NO fully working integrations found!\n');
      console.log('👉 YOU NEED TO:');
      console.log('   1. Delete existing integrations from your UI');
      console.log('   2. Reconnect using manual integration with the credentials above');
      console.log('   3. Make sure you are LOGGED IN when you connect');
      console.log('   4. The system will automatically set userId and pageAccessToken\n');
    } else {
      console.log(`✅ Instagram working: ${workingInstagram.length}`);
      console.log(`✅ Facebook working: ${workingFacebook.length}\n`);
      
      console.log('These integrations should work now! Try sending a message.\n');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('========================================');
  console.log('🎯 NEXT STEPS');
  console.log('========================================\n');
  
  console.log('1. Make sure backend server is running (npm run dev)');
  console.log('2. Log in to your platform');
  console.log('3. Go to Integrations page');
  console.log('4. For Instagram:');
  console.log('   - Delete existing integration');
  console.log('   - Click "Connect Instagram" (Manual)');
  console.log('   - Enter the credentials shown above');
  console.log('5. For Facebook:');
  console.log('   - Delete existing integration');
  console.log('   - Click "Connect Facebook" (Manual)');
  console.log('   - Enter the credentials shown above');
  console.log('6. Send a test message from Instagram/Facebook to your page');
  console.log('7. Check backend logs for webhook processing\n');
}

main();
