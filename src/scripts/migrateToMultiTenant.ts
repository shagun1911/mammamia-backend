import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase } from '../config/database';
import User from '../models/User';
import Organization from '../models/Organization';
import Conversation from '../models/Conversation';

/**
 * Migration Script: Add Multi-Tenant Support
 * 
 * This script:
 * 1. Creates an organization for existing users who don't have one
 * 2. Updates all conversations to belong to the user's organization
 */
async function migrateToMultiTenant() {
  console.log('🔄 Starting multi-tenant migration...\n');

  try {
    await connectDatabase();

    // Step 1: Find all users without organizationId
    const usersWithoutOrg = await User.find({ 
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    });

    console.log(`📊 Found ${usersWithoutOrg.length} users without organization\n`);

    for (const user of usersWithoutOrg) {
      console.log(`👤 Processing user: ${user.email}`);

      // Create organization for this user
      const orgName = `${user.firstName}'s Organization`;
      const userId = user._id as any;
      const orgSlug = `${user.firstName.toLowerCase()}-${userId.toString().slice(-6)}`;

      const organization = await Organization.create({
        name: orgName,
        slug: orgSlug,
        status: 'active',
        plan: 'free',
        ownerId: userId
      });

      console.log(`  ✅ Created organization: ${orgName}`);

      // Update user with organizationId
      user.organizationId = organization._id as any;
      await user.save();

      console.log(`  ✅ Updated user with organizationId\n`);
    }

    // Step 2: Update conversations without organizationId
    console.log('📝 Updating conversations...');
    
    const conversationsWithoutOrg = await Conversation.find({
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    });

    console.log(`📊 Found ${conversationsWithoutOrg.length} conversations without organization\n`);

    // Get the first user (admin) to assign orphaned conversations
    const adminUser = await User.findOne({ role: 'admin' });
    
    if (adminUser && adminUser.organizationId) {
      console.log(`📌 Assigning orphaned conversations to admin's organization\n`);
      
      await Conversation.updateMany(
        {
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null }
          ]
        },
        { $set: { organizationId: adminUser.organizationId } }
      );

      console.log(`  ✅ Updated ${conversationsWithoutOrg.length} conversations\n`);
    }

    console.log('✨ Migration completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`   - Organizations created: ${usersWithoutOrg.length}`);
    console.log(`   - Users updated: ${usersWithoutOrg.length}`);
    console.log(`   - Conversations updated: ${conversationsWithoutOrg.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateToMultiTenant();

