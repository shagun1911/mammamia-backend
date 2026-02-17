/**
 * Debug Script: Check Instagram and Facebook Integration Credentials
 * 
 * This script checks what's stored in the database for Instagram/Facebook integrations
 * and verifies if the credentials match the expected values.
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Define schema with strict: false to read any fields
const SocialIntegrationSchema = new mongoose.Schema({}, { strict: false });
const SocialIntegration = mongoose.model('SocialIntegration', SocialIntegrationSchema);

async function main() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Expected values from the user
    const expectedFacebookPageId = '1006770519175890';
    const expectedInstagramAccountId = '17841480066717301';

    console.log('========================================');
    console.log('📋 EXPECTED VALUES:');
    console.log('========================================');
    console.log('Facebook Page ID:', expectedFacebookPageId);
    console.log('Instagram Account ID:', expectedInstagramAccountId);
    console.log('');

    // Find all Instagram integrations
    console.log('========================================');
    console.log('🔍 SEARCHING FOR INSTAGRAM INTEGRATIONS');
    console.log('========================================\n');
    
    const instagramIntegrations = await SocialIntegration.find({
      platform: 'instagram'
    }).lean();

    console.log(`Found ${instagramIntegrations.length} Instagram integration(s)\n`);

    instagramIntegrations.forEach((integration, index) => {
      console.log(`--- Instagram Integration #${index + 1} ---`);
      console.log('ID:', integration._id);
      console.log('Platform:', integration.platform);
      console.log('Status:', integration.status);
      console.log('UserId:', integration.userId);
      console.log('OrganizationId:', integration.organizationId);
      console.log('');
      console.log('Credentials:');
      console.log('  - Instagram Account ID:', integration.credentials?.instagramAccountId);
      console.log('  - Facebook Page ID:', integration.credentials?.facebookPageId);
      console.log('  - Has Page Access Token:', !!integration.credentials?.pageAccessToken);
      console.log('  - Page Access Token Length:', integration.credentials?.pageAccessToken?.length || 0);
      console.log('  - Page Access Token Prefix:', integration.credentials?.pageAccessToken?.substring(0, 10) || 'N/A');
      console.log('  - Has API Key:', !!integration.credentials?.apiKey);
      console.log('');
      
      // Check if it matches expected values
      if (integration.credentials?.instagramAccountId === expectedInstagramAccountId) {
        console.log('✅ Instagram Account ID MATCHES expected value');
      } else {
        console.log('❌ Instagram Account ID DOES NOT MATCH');
        console.log('   Expected:', expectedInstagramAccountId);
        console.log('   Got:', integration.credentials?.instagramAccountId);
      }
      
      if (integration.credentials?.facebookPageId === expectedFacebookPageId) {
        console.log('✅ Facebook Page ID MATCHES expected value');
      } else {
        console.log('❌ Facebook Page ID DOES NOT MATCH');
        console.log('   Expected:', expectedFacebookPageId);
        console.log('   Got:', integration.credentials?.facebookPageId);
      }
      console.log('\n');
    });

    // Find all Facebook integrations
    console.log('========================================');
    console.log('🔍 SEARCHING FOR FACEBOOK/MESSENGER INTEGRATIONS');
    console.log('========================================\n');
    
    const facebookIntegrations = await SocialIntegration.find({
      platform: 'facebook'
    }).lean();

    console.log(`Found ${facebookIntegrations.length} Facebook integration(s)\n`);

    facebookIntegrations.forEach((integration, index) => {
      console.log(`--- Facebook Integration #${index + 1} ---`);
      console.log('ID:', integration._id);
      console.log('Platform:', integration.platform);
      console.log('Status:', integration.status);
      console.log('UserId:', integration.userId);
      console.log('OrganizationId:', integration.organizationId);
      console.log('');
      console.log('Credentials:');
      console.log('  - Facebook Page ID:', integration.credentials?.facebookPageId);
      console.log('  - Has Page Access Token:', !!integration.credentials?.pageAccessToken);
      console.log('  - Page Access Token Length:', integration.credentials?.pageAccessToken?.length || 0);
      console.log('  - Page Access Token Prefix:', integration.credentials?.pageAccessToken?.substring(0, 10) || 'N/A');
      console.log('  - Has API Key:', !!integration.credentials?.apiKey);
      console.log('');
      
      // Check if it matches expected values
      if (integration.credentials?.facebookPageId === expectedFacebookPageId) {
        console.log('✅ Facebook Page ID MATCHES expected value');
      } else {
        console.log('❌ Facebook Page ID DOES NOT MATCH');
        console.log('   Expected:', expectedFacebookPageId);
        console.log('   Got:', integration.credentials?.facebookPageId);
      }
      console.log('\n');
    });

    console.log('========================================');
    console.log('📝 SUMMARY');
    console.log('========================================');
    console.log('Total Instagram integrations:', instagramIntegrations.length);
    console.log('Total Facebook integrations:', facebookIntegrations.length);
    console.log('');
    
    // Check if any integration matches
    const matchingInstagram = instagramIntegrations.find(i => 
      i.credentials?.instagramAccountId === expectedInstagramAccountId
    );
    const matchingFacebook = facebookIntegrations.find(i => 
      i.credentials?.facebookPageId === expectedFacebookPageId
    );
    
    if (matchingInstagram) {
      console.log('✅ Found matching Instagram integration');
      console.log('   Integration ID:', matchingInstagram._id);
      console.log('   Status:', matchingInstagram.status);
      console.log('   Has valid token:', !!matchingInstagram.credentials?.pageAccessToken);
    } else {
      console.log('❌ NO matching Instagram integration found');
      console.log('   This is why Instagram is not working!');
      console.log('   You need to reconnect Instagram with the correct Account ID');
    }
    
    if (matchingFacebook) {
      console.log('✅ Found matching Facebook integration');
      console.log('   Integration ID:', matchingFacebook._id);
      console.log('   Status:', matchingFacebook.status);
      console.log('   Has valid token:', !!matchingFacebook.credentials?.pageAccessToken);
    } else {
      console.log('❌ NO matching Facebook integration found');
      console.log('   This is why Facebook is not working!');
      console.log('   You need to reconnect Facebook with the correct Page ID');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

main();
