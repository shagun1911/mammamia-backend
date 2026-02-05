// Check Gmail integration status
const mongoose = require('mongoose');
require('dotenv').config();

const SocialIntegrationSchema = new mongoose.Schema({}, { strict: false });
const SocialIntegration = mongoose.model('SocialIntegration', SocialIntegrationSchema);

async function checkGmailIntegration() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const organizationId = '698372de423bec058d58024a';
    const userId = '698372de423bec058d58024a';

    const gmailIntegration = await SocialIntegration.findOne({
      organizationId: new mongoose.Types.ObjectId(organizationId),
      platform: 'gmail',
      status: 'connected'
    }).lean();

    console.log('🔍 Gmail Integration Status:');
    if (gmailIntegration) {
      console.log('   ✅ CONNECTED');
      console.log('   User Email:', gmailIntegration.email || 'Not set');
      console.log('   Status:', gmailIntegration.status);
      console.log('   Created:', gmailIntegration.createdAt);
    } else {
      console.log('   ❌ NOT CONNECTED');
      console.log('\n   You need to connect Gmail integration first!');
      console.log('   Go to: Configuration → Integrations → Gmail');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkGmailIntegration();
