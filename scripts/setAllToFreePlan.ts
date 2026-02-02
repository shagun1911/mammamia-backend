// Script to set all users and organizations to the 'free' plan
import mongoose from 'mongoose';
import User from '../src/models/User';
import Organization from '../src/models/Organization';
import Plan from '../src/models/Plan';
import dotenv from 'dotenv';
dotenv.config();

async function setAllToFreePlan() {
  await mongoose.connect(process.env.MONGODB_URI || '', { dbName: process.env.DB_NAME });

  // Find the free plan
  const freePlan = await Plan.findOne({ slug: 'free' });
  if (!freePlan) {
    console.error('No free plan found in the database.');
    process.exit(1);
  }

  // Update all users
  await User.updateMany({}, { $set: { selectedProfile: 'free' } });

  // Update all organizations
  await Organization.updateMany({}, { $set: { plan: 'free', planId: freePlan._id } });

  // Also update all users in organizations to ensure consistency
  const orgs = await Organization.find({});
  for (const org of orgs) {
    await User.updateMany({ organizationId: org._id }, { $set: { selectedProfile: 'free' } });
  }

  // Optionally: log how many were updated for audit/debug
  const userCount = await User.countDocuments({ selectedProfile: 'free' });
  const orgCount = await Organization.countDocuments({ plan: 'free' });
  console.log(`All users and organizations have been set to the free plan. Users: ${userCount}, Organizations: ${orgCount}`);
  process.exit(0);
}

setAllToFreePlan().catch(err => {
  console.error(err);
  process.exit(1);
});
