import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import { logger } from '../utils/logger.util';

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    const adminExists = await User.findOne({ email: 'admin@test.com' });

    if (!adminExists) {
      await User.create({
        email: 'admin@test.com',
        passwordHash: 'admin123',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        permissions: ['all'],
        status: 'active'
      });
      logger.info('✅ Admin user created successfully!');
      logger.info('Email: admin@test.com');
      logger.info('Password: admin123');
    } else {
      logger.info('Admin user already exists');
    }

    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error seeding admin user:', error.message);
    process.exit(1);
  }
};

seedAdmin();

