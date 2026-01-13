import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import { logger } from '../utils/logger.util';

dotenv.config();

const createUser = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    const email = 'aisteinit@gmail.com';
    const password = '12345678';

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      logger.info(`⚠️  User already exists: ${email}`);
      logger.info('Deleting existing user and creating new one...');
      await User.findOneAndDelete({ email });
    }

    // Create new user
    const newUser = await User.create({
      email,
      password,
      firstName: 'Aistein',
      lastName: 'IT',
      role: 'admin',
      permissions: ['all'],
      status: 'active',
      provider: 'local'
    });

    logger.info(`✅ User created successfully: ${newUser.email}`);
    logger.info(`   Password: ${password}`);
    logger.info(`   Role: ${newUser.role}`);

    await mongoose.disconnect();
    logger.info('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error creating user:', error.message);
    process.exit(1);
  }
};

createUser();

