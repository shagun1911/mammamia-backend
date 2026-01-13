import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Folder from '../models/Folder';
import Label from '../models/Label';
import { logger } from '../utils/logger.util';

dotenv.config();

const seedFoldersAndLabels = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    // Seed folders
    const defaultFolders = [
      { name: 'Sales', color: '#6366f1' },
      { name: 'Support', color: '#10b981' },
      { name: 'VIP', color: '#f59e0b' }
    ];

    for (const folder of defaultFolders) {
      const exists = await Folder.findOne({ name: folder.name });
      if (!exists) {
        await Folder.create(folder);
        logger.info(`✅ Created folder: ${folder.name}`);
      } else {
        logger.info(`Folder already exists: ${folder.name}`);
      }
    }

    // Seed labels
    const defaultLabels = [
      { name: 'urgent', color: '#ef4444' },
      { name: 'order_issue', color: '#f59e0b' },
      { name: 'vip', color: '#8b5cf6' },
      { name: 'pending', color: '#6b7280' },
      { name: 'resolved', color: '#10b981' }
    ];

    for (const label of defaultLabels) {
      const exists = await Label.findOne({ name: label.name });
      if (!exists) {
        await Label.create(label);
        logger.info(`✅ Created label: ${label.name}`);
      } else {
        logger.info(`Label already exists: ${label.name}`);
      }
    }

    logger.info('🎉 Seeding complete!');
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error seeding folders and labels:', error.message);
    process.exit(1);
  }
};

seedFoldersAndLabels();

