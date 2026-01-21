/**
 * Migration Script: Assign Free Plan to All Organizations
 * 
 * This script assigns the "free" plan to all organizations that don't have a planId set.
 * Run this once to migrate existing data.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Organization from '../models/Organization';
import Plan from '../models/Plan';
import { logger } from '../utils/logger.util';

dotenv.config();

const assignFreePlanToAll = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('✅ Connected to MongoDB');

    // Find or create the free plan
    let freePlan = await Plan.findOne({ slug: 'free' });

    if (!freePlan) {
      logger.info('📦 Free plan not found, creating it...');
      freePlan = await Plan.create({
        name: 'Free',
        slug: 'free',
        description: 'Perfect for getting started',
        price: 0,
        currency: 'USD',
        features: {
          callMinutes: 100,
          chatConversations: 100,
          automations: 5,
          users: 1,
          customFeatures: ['Basic support', '1 workspace']
        },
        isActive: true,
        isDefault: true,
        displayOrder: 1
      });
      logger.info('✅ Created free plan');
    }

    // Find all organizations without a planId
    const orgsWithoutPlan = await Organization.find({
      $or: [
        { planId: { $exists: false } },
        { planId: null }
      ]
    });

    logger.info(`📊 Found ${orgsWithoutPlan.length} organizations without a plan`);

    if (orgsWithoutPlan.length === 0) {
      logger.info('✅ All organizations already have a plan assigned');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Assign free plan to all organizations
    const result = await Organization.updateMany(
      {
        $or: [
          { planId: { $exists: false } },
          { planId: null }
        ]
      },
      {
        $set: {
          planId: freePlan._id,
          plan: 'free'
        }
      }
    );

    logger.info(`✅ Updated ${result.modifiedCount} organizations with free plan`);

    // Verify the update
    const verifyCount = await Organization.countDocuments({ planId: freePlan._id });
    logger.info(`✅ Verification: ${verifyCount} organizations now have the free plan`);

    await mongoose.disconnect();
    logger.info('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error assigning free plan:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Run the script
assignFreePlanToAll();
