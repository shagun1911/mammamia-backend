// Hardcode Instagram integration with working IGA token
const { MongoClient, ObjectId } = require('mongodb');

const IG_ACCESS_TOKEN = 'IGAARetUu1EY5BZAGJmVzRlRExsMXpKMXVJcHA2c01US2tNU2lVT1NtdGcwMGNid0pSU0tUemJiM2E1bHNGcndMZA2lNMG5kQi1sNTBIbnFEX3NtQlZArSFNGRmlxaXdMWXhDNEVqZAXluTmFDU3BwSlVxbVUzM19IXzA5MmQzSmlmQQZDZD';

// Replace with actual values from your app
const USER_ID = '69ca55bff0174d1308e92b70';  // Your user ID
const ORG_ID = '69ca55bef0174d1308e92b6d';   // Your organization ID
const INSTAGRAM_ACCOUNT_ID = '17841480066717301';  // From your earlier logs

async function insertIntegration() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb+srv://aistein:Aistein123@cluster0.qxrpj.mongodb.net/aistein-it?retryWrites=true&w=majority');
  
  try {
    await client.connect();
    const db = client.db();
    const integrations = db.collection('socialintegrations');
    
    // Delete any existing Instagram integration for this user
    await integrations.deleteMany({
      userId: new ObjectId(USER_ID),
      platform: 'instagram'
    });
    
    // Insert new integration with hardcoded IGA token
    const result = await integrations.insertOne({
      userId: new ObjectId(USER_ID),
      organizationId: new ObjectId(ORG_ID),
      platform: 'instagram',
      status: 'connected',
      instagramAccountId: INSTAGRAM_ACCOUNT_ID,
      clientId: '1230032859091854',  // INSTA_APP_ID
      apiKey: IG_ACCESS_TOKEN,
      credentials: {
        apiKey: IG_ACCESS_TOKEN,
        clientId: '1230032859091854',
        instagramAccountId: INSTAGRAM_ACCOUNT_ID,
        tokenType: 'instagram_user_token'
      },
      chatbotEnabled: true,
      webhookVerified: true,
      metadata: {
        userName: 'Instagram User',
        connectedAt: new Date().toISOString(),
        chatbotEnabled: true
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log('✅ Instagram integration inserted:', result.insertedId);
    console.log('Token stored:', IG_ACCESS_TOKEN.substring(0, 20) + '...');
  } finally {
    await client.close();
  }
}

insertIntegration().catch(console.error);
