import mongoose from 'mongoose';
import dotenv from 'dotenv';
import KnowledgeBase from '../models/KnowledgeBase';
import FAQ from '../models/FAQ';
import Prompt from '../models/Prompt';
import { logger } from '../utils/logger.util';

dotenv.config();

const seedKnowledgeBase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('Connected to MongoDB');

    // Create default knowledge base
    let kb = await KnowledgeBase.findOne({ isDefault: true });
    
    if (!kb) {
      kb = await KnowledgeBase.create({
        name: 'Default Knowledge Base',
        isDefault: true,
        spaceUsed: 0
      });
      logger.info('✅ Created default knowledge base');
    } else {
      logger.info('Default knowledge base already exists');
    }

    // Seed some example FAQs
    const exampleFAQs = [
      {
        question: 'What are your business hours?',
        answer: 'We are open Monday to Friday, 9 AM to 5 PM EST. We are closed on weekends and major holidays.'
      },
      {
        question: 'How can I track my order?',
        answer: 'You can track your order by logging into your account and visiting the Orders section. You will also receive tracking information via email once your order ships.'
      },
      {
        question: 'What is your return policy?',
        answer: 'We offer a 30-day return policy for most items. Products must be in their original condition with tags attached. Please contact our support team to initiate a return.'
      },
      {
        question: 'Do you ship internationally?',
        answer: 'Yes, we ship to most countries worldwide. Shipping costs and delivery times vary by location. International orders may be subject to customs fees.'
      },
      {
        question: 'How do I reset my password?',
        answer: 'Click on "Forgot Password" on the login page. Enter your email address and we will send you a link to reset your password.'
      }
    ];

    for (const faqData of exampleFAQs) {
      const exists = await FAQ.findOne({
        knowledgeBaseId: kb._id,
        question: faqData.question
      });

      if (!exists) {
        await FAQ.create({
          knowledgeBaseId: kb._id,
          ...faqData
        });
        logger.info(`✅ Created FAQ: ${faqData.question}`);
      } else {
        logger.info(`FAQ already exists: ${faqData.question}`);
      }
    }

    // Create default prompts
    const chatbotPromptExists = await Prompt.findOne({ type: 'chatbot' });
    if (!chatbotPromptExists) {
      await Prompt.create({
        type: 'chatbot',
        userInstructions: 'Be friendly and helpful. Always ask for order numbers when helping with order-related issues. If you don\'t know the answer, escalate to a human operator.',
        systemPrompt: 'You are a helpful customer support AI assistant. Your role is to assist customers with their questions and issues.\n\nAdditional Instructions:\nBe friendly and helpful. Always ask for order numbers when helping with order-related issues. If you don\'t know the answer, escalate to a human operator.\n\nAlways be professional, helpful, and use the knowledge base provided to answer questions accurately.',
        version: 1
      });
      logger.info('✅ Created default chatbot prompt');
    } else {
      logger.info('Chatbot prompt already exists');
    }

    const voicePromptExists = await Prompt.findOne({ type: 'voice' });
    if (!voicePromptExists) {
      await Prompt.create({
        type: 'voice',
        userInstructions: 'Keep responses short and natural for voice conversations. Speak clearly and avoid long explanations.',
        systemPrompt: 'You are a voice AI assistant for customer support calls. Speak naturally and be concise.\n\nAdditional Instructions:\nKeep responses short and natural for voice conversations. Speak clearly and avoid long explanations.\n\nAlways be professional, helpful, and use the knowledge base provided to answer questions accurately.',
        version: 1
      });
      logger.info('✅ Created default voice prompt');
    } else {
      logger.info('Voice prompt already exists');
    }

    logger.info('🎉 Seeding complete!');
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error seeding knowledge base:', error.message);
    process.exit(1);
  }
};

seedKnowledgeBase();

