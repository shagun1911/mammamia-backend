/**
 * Wipe ALL SocialIntegration documents from the database.
 *
 * Use this so no social account (WhatsApp, Instagram, Facebook, Gmail) is
 * linked to any user/org. After running, users can reconnect with the same
 * social credentials without conflicts or stale-ID errors.
 *
 * Usage:
 *   From backend root: npx ts-node scripts/wipe-all-social-integrations.ts
 *   Or: npm run wipe:social-integrations
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import SocialIntegration from '../src/models/SocialIntegration';

dotenv.config();

async function wipeAllSocialIntegrations() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kepleroai';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const count = await SocialIntegration.countDocuments({});
    console.log(`\n📊 Found ${count} social integration(s) in the database.`);

    if (count === 0) {
      console.log('✅ No social integrations to delete. Database is already clear.');
      await mongoose.disconnect();
      return;
    }

    console.log('⚠️  This will DELETE ALL social integrations (WhatsApp, Instagram, Facebook, Gmail).');
    console.log('⚠️  Users will need to reconnect their social accounts. Press Ctrl+C to cancel.');
    console.log('⚠️  Proceeding in 5 seconds...\n');
    await new Promise((r) => setTimeout(r, 5000));

    const result = await SocialIntegration.deleteMany({});
    console.log(`\n✅ Deleted ${result.deletedCount} social integration(s).`);
    console.log('✅ No social account is linked anymore. Reconnecting with the same creds will not cause errors.');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

wipeAllSocialIntegrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
