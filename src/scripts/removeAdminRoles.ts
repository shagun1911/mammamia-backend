import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import { logger } from '../utils/logger.util';

dotenv.config();

/**
 * Script to remove admin role from all users except the official admin
 * Official admin is: admin@aistein.ai (created by createAdmin script)
 */
const removeAdminRoles = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('✅ Connected to MongoDB');

    // Official admin email (from createAdmin script)
    const officialAdminEmail = 'admin@aistein.ai';

    // Find all users with admin role
    const adminUsers = await User.find({ role: 'admin' }).lean();
    logger.info(`📊 Found ${adminUsers.length} users with admin role`);

    if (adminUsers.length === 0) {
      logger.info('ℹ️  No admin users found');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Display all admin users
    logger.info('\n📋 Current Admin Users:');
    adminUsers.forEach((user: any, index: number) => {
      logger.info(`${index + 1}. ${user.email} (ID: ${user._id})`);
    });

    // Find official admin
    const officialAdmin = adminUsers.find((u: any) => u.email.toLowerCase() === officialAdminEmail.toLowerCase());

    if (!officialAdmin) {
      logger.warn(`⚠️  Official admin (${officialAdminEmail}) not found!`);
      logger.warn('⚠️  This script will remove admin role from ALL users.');
      logger.warn('⚠️  You may need to create the official admin first using: npm run create:admin');
    } else {
      logger.info(`\n✅ Official admin found: ${officialAdminEmail} (ID: ${officialAdmin._id})`);
    }

    // Update all admin users except official admin
    let updatedCount = 0;
    let skippedCount = 0;

    for (const user of adminUsers) {
      const userEmail = user.email.toLowerCase();
      
      // Skip official admin
      if (userEmail === officialAdminEmail.toLowerCase()) {
        logger.info(`⏭️  Skipping official admin: ${user.email}`);
        skippedCount++;
        continue;
      }

      // Update role to operator
      await User.findByIdAndUpdate(user._id, {
        role: 'operator',
        permissions: [] // Remove admin permissions
      });

      logger.info(`✅ Updated ${user.email}: admin → operator`);
      updatedCount++;
    }

    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📊 Summary:');
    logger.info(`   Total admin users found: ${adminUsers.length}`);
    logger.info(`   Official admin (kept): ${skippedCount}`);
    logger.info(`   Updated to operator: ${updatedCount}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Verify: Check remaining admin users
    const remainingAdmins = await User.find({ role: 'admin' }).lean();
    logger.info(`\n✅ Verification: ${remainingAdmins.length} admin user(s) remaining`);
    
    if (remainingAdmins.length > 0) {
      logger.info('Remaining admin users:');
      remainingAdmins.forEach((user: any) => {
        logger.info(`   - ${user.email} (ID: ${user._id})`);
      });
    }

    if (remainingAdmins.length === 1 && remainingAdmins[0].email.toLowerCase() === officialAdminEmail.toLowerCase()) {
      logger.info('\n✅ SUCCESS: Only official admin remains!');
    } else if (remainingAdmins.length === 0) {
      logger.warn('\n⚠️  WARNING: No admin users remaining!');
      logger.warn('⚠️  You may need to create the official admin using: npm run create:admin');
    } else {
      logger.warn(`\n⚠️  WARNING: ${remainingAdmins.length} admin user(s) still exist`);
      logger.warn('⚠️  Please review the list above');
    }

    await mongoose.disconnect();
    logger.info('\n✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error removing admin roles:', error.message);
    logger.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Show usage if help is requested
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run remove:admin-roles

This script will:
  1. Find all users with role='admin'
  2. Keep only the official admin (admin@aistein.ai)
  3. Change all other users' role to 'operator'
  4. Remove admin permissions from updated users

Official Admin Email: admin@aistein.ai

⚠️  WARNING: This will remove admin access from all users except admin@aistein.ai
⚠️  Make sure you have the admin@aistein.ai credentials before running this script!

Examples:
  npm run remove:admin-roles
  `);
  process.exit(0);
}

// Run the script
removeAdminRoles();
