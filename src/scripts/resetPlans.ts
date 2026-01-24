import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Plan from '../models/Plan';
import { logger } from '../utils/logger.util';

dotenv.config();

const resetPlans = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
        logger.info('Connected to MongoDB');

        logger.info('Deleting existing plans...');
        await Plan.deleteMany({});
        logger.info('✅ All plans deleted.');

        // Import planService dynamically to ensure connection is established if needed, though we connected above.
        // Actually planService doesn't connect, it uses mongoose models which are bound to the connection.
        const { planService } = await import('../services/plan.service');

        logger.info('Initializing new default plans...');
        await planService.initializeDefaultPlans();

        logger.info('✅ Default plans re-initialized successfully.');

        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
        process.exit(0);
    } catch (error: any) {
        logger.error('Error resetting plans:', error.message);
        process.exit(1);
    }
};

resetPlans();
