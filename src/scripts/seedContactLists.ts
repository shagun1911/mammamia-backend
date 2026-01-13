import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ContactList from '../models/ContactList';
import { logger } from '../utils/logger.util';

dotenv.config();

const seedContactLists = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    logger.info('Connected to MongoDB');

    const systemLists = [
      { name: 'All', isSystem: true, kanbanEnabled: false },
      { name: 'From Contact Form', isSystem: true, kanbanEnabled: false }
    ];

    for (const listData of systemLists) {
      const exists = await ContactList.findOne({ name: listData.name });
      if (!exists) {
        await ContactList.create(listData);
        logger.info(`Created system list: ${listData.name}`);
      } else {
        logger.info(`System list already exists: ${listData.name}`);
      }
    }

    logger.info('Contact lists seeded successfully!');
    await mongoose.disconnect();
  } catch (error: any) {
    logger.error('Error seeding contact lists:', error.message);
    process.exit(1);
  }
};

seedContactLists();

