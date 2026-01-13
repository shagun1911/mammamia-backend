import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import { logger } from '../utils/logger.util';

dotenv.config();

const recreateUser = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    const emailToRecreate = 'infoitaliaia@gmail.com';

    // Delete existing user
    const deletedUser = await User.findOneAndDelete({ email: emailToRecreate });
    
    if (deletedUser) {
      logger.info(`🗑️  Deleted existing user: ${emailToRecreate}`);
    } else {
      logger.info(`ℹ️  No existing user found with email: ${emailToRecreate}`);
    }

    // Create new user
    const newUser = await User.create({
      email: emailToRecreate,
      password: '12345678',
      firstName: 'Info',
      lastName: 'ItaliaIA',
      role: 'admin',
      permissions: ['all'],
      status: 'active',
      provider: 'local'
    });

    logger.info(`✅ User created successfully: ${newUser.email}`);
    logger.info(`   Password: 12345678`);
    logger.info(`   Role: ${newUser.role}`);

    await mongoose.disconnect();
    logger.info('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error recreating user:', error.message);
    process.exit(1);
  }
};

recreateUser();

