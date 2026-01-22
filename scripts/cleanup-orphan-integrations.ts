/**
 * Cleanup Script: Delete SocialIntegration documents with missing userId
 * 
 * This script removes orphan integrations that were created before userId
 * was made a required field. These integrations cause data isolation issues
 * in webhook handlers.
 * 
 * Usage:
 *   npx ts-node scripts/cleanup-orphan-integrations.ts
 * 
 * WARNING: This script DELETES data. Run in development first, then production.
 */

import mongoose from 'mongoose';
import SocialIntegration from '../src/models/SocialIntegration';

async function cleanupOrphanIntegrations() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kepleroai';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find all integrations with missing userId
    const orphanIntegrations = await SocialIntegration.find({
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    }).lean();

    console.log(`\n📊 Found ${orphanIntegrations.length} orphan integration(s) (missing userId)`);

    if (orphanIntegrations.length === 0) {
      console.log('✅ No orphan integrations found. Database is clean.');
      await mongoose.disconnect();
      return;
    }

    // Log details
    console.log('\n📋 Orphan integrations to be deleted:');
    orphanIntegrations.forEach((integration, index) => {
      console.log(`  ${index + 1}. ID: ${integration._id}`);
      console.log(`     Platform: ${integration.platform}`);
      console.log(`     OrganizationId: ${integration.organizationId}`);
      console.log(`     Status: ${integration.status}`);
      console.log(`     Created: ${integration.createdAt}`);
      console.log('');
    });

    // Confirm deletion (in production, you might want to add a confirmation prompt)
    console.log('⚠️  WARNING: This will DELETE the above integrations.');
    console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    
    // Wait 5 seconds for cancellation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Delete orphan integrations
    const deleteResult = await SocialIntegration.deleteMany({
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    });

    console.log(`\n✅ Deleted ${deleteResult.deletedCount} orphan integration(s)`);
    console.log('✅ Cleanup completed successfully');

    // Verify cleanup
    const remainingOrphans = await SocialIntegration.countDocuments({
      $or: [
        { userId: { $exists: false } },
        { userId: null }
      ]
    });

    if (remainingOrphans > 0) {
      console.warn(`⚠️  WARNING: ${remainingOrphans} orphan integration(s) still remain.`);
    } else {
      console.log('✅ Verification: No orphan integrations remain.');
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error: any) {
    console.error('❌ Error during cleanup:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run cleanup
cleanupOrphanIntegrations()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

