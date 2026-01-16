import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import { logger } from '../utils/logger.util';

dotenv.config();

const createUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    const usersToCreate = [
      {
        email: 'jmimpera@gmail.com',
        password: '12345678',
        firstName: 'JM',
        lastName: 'Impera',
        role: 'admin' as const,
        permissions: ['all'],
        status: 'active' as const,
        provider: 'local' as const
      },
      
      {
        email: 'infoitaliaia@gmail.com',
        password: '12345678',
        firstName: 'Info',
        lastName: 'ItaliaIA',
        role: 'admin' as const,
        permissions: ['all'],
        status: 'active' as const,
        provider: 'local' as const
      }
    ];

    for (const userData of usersToCreate) {
      const existingUser = await User.findOne({ email: userData.email });

      if (!existingUser) {
        await User.create(userData);
        logger.info(`✅ User created successfully: ${userData.email}`);
        logger.info(`   Password: ${userData.password}`);
      } else {
        logger.info(`⚠️  User already exists: ${userData.email}`);
      }
    }

    logger.info('\n=== User Creation Summary ===');
    logger.info('Email: jmimpera@gmail.com | Password: 12345678');
    logger.info('Email: infoitaliaia@gmail.com | Password: 12345678');

    await mongoose.disconnect();
    logger.info('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error creating users:', error.message);
    process.exit(1);
  }
};

createUsers();

