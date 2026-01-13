import Topic from '../models/Topic';
import Message from '../models/Message';
import Conversation from '../models/Conversation';
import { AppError } from '../middleware/error.middleware';

export class TopicService {
  async findAll() {
    const topics = await Topic.find().sort({ createdAt: -1 }).lean();
    
    // Get message count for each topic
    const topicsWithCount = await Promise.all(
      topics.map(async (topic: any) => {
        const count = await Message.countDocuments({ topics: topic.name });
        return {
          ...topic,
          messageCount: count
        };
      })
    );

    return topicsWithCount;
  }

  async findById(topicId: string) {
    const topic = await Topic.findById(topicId).lean();

    if (!topic) {
      throw new AppError(404, 'NOT_FOUND', 'Topic not found');
    }

    return topic;
  }

  async create(topicData: { name: string; color?: string }) {
    // Check if topic already exists
    const existing = await Topic.findOne({ name: topicData.name });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'Topic with this name already exists');
    }

    const topic = await Topic.create(topicData);
    return topic;
  }

  async update(topicId: string, topicData: { name?: string; color?: string }) {
    const topic = await Topic.findById(topicId);

    if (!topic) {
      throw new AppError(404, 'NOT_FOUND', 'Topic not found');
    }

    // Check if new name conflicts
    if (topicData.name && topicData.name !== topic.name) {
      const existing = await Topic.findOne({ name: topicData.name });
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Topic with this name already exists');
      }

      // Update topic name in all messages
      await Message.updateMany(
        { topics: topic.name },
        { $set: { "topics.$": topicData.name } }
      );
    }

    Object.assign(topic, topicData);
    await topic.save();

    return topic;
  }

  async delete(topicId: string) {
    const topic = await Topic.findByIdAndDelete(topicId);

    if (!topic) {
      throw new AppError(404, 'NOT_FOUND', 'Topic not found');
    }

    // Remove topic from all messages
    await Message.updateMany(
      { topics: topic.name },
      { $pull: { topics: topic.name } }
    );

    return { message: 'Topic deleted successfully' };
  }

  async detectTopics(conversationId?: string, analyzeAll = false) {
    let messages;

    if (conversationId) {
      // Analyze specific conversation
      messages = await Message.find({ conversationId })
        .select('text topics')
        .lean();
    } else if (analyzeAll) {
      // Analyze recent messages (last 1000)
      messages = await Message.find()
        .sort({ timestamp: -1 })
        .limit(1000)
        .select('_id text topics')
        .lean();
    } else {
      throw new AppError(400, 'VALIDATION_ERROR', 'Must provide conversationId or set analyzeAll to true');
    }

    // Get all existing topics
    const existingTopics = await Topic.find().select('name').lean();
    const topicNames = existingTopics.map(t => t.name.toLowerCase());

    // Common keywords for topic detection
    const topicKeywords: Record<string, string[]> = {
      'billing': ['payment', 'invoice', 'bill', 'charge', 'refund', 'price', 'cost', 'subscription'],
      'technical support': ['error', 'bug', 'issue', 'problem', 'not working', 'broken', 'crash', 'technical'],
      'shipping': ['delivery', 'shipping', 'shipment', 'track', 'package', 'arrive', 'shipping'],
      'product inquiry': ['product', 'feature', 'how to', 'specification', 'details', 'information'],
      'account': ['account', 'login', 'password', 'username', 'profile', 'settings'],
      'complaint': ['complaint', 'unhappy', 'disappointed', 'unsatisfied', 'angry', 'frustrated'],
      'feedback': ['feedback', 'suggestion', 'recommend', 'improve', 'better'],
      'order': ['order', 'purchase', 'buy', 'cart', 'checkout']
    };

    let detectedCount = 0;

    for (const message of messages) {
      if (!message.text) continue;

      const text = message.text.toLowerCase();
      const detectedTopics: string[] = [];

      // Check for existing topics
      for (const topicName of topicNames) {
        if (text.includes(topicName)) {
          detectedTopics.push(topicName);
        }
      }

      // Check for keyword-based topics
      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        const hasKeyword = keywords.some(keyword => text.includes(keyword));
        if (hasKeyword && !detectedTopics.includes(topic)) {
          detectedTopics.push(topic);
          
          // Create topic if it doesn't exist
          const topicExists = await Topic.findOne({ name: topic });
          if (!topicExists) {
            await Topic.create({ name: topic });
          }
        }
      }

      // Update message with detected topics
      if (detectedTopics.length > 0) {
        await Message.findByIdAndUpdate((message as any)._id, {
          $addToSet: { topics: { $each: detectedTopics } }
        });
        detectedCount++;
      }
    }

    return {
      messagesAnalyzed: messages.length,
      topicsDetected: detectedCount,
      message: `Analyzed ${messages.length} messages and detected topics in ${detectedCount} messages`
    };
  }

  async getTopicStats(topicName: string, dateFrom?: string, dateTo?: string) {
    const dateQuery: any = {};
    if (dateFrom || dateTo) {
      dateQuery.timestamp = {};
      if (dateFrom) dateQuery.timestamp.$gte = new Date(dateFrom);
      if (dateTo) dateQuery.timestamp.$lte = new Date(dateTo);
    }

    const messages = await Message.find({
      ...dateQuery,
      topics: topicName
    }).select('conversationId timestamp').lean();

    const uniqueConversations = new Set(messages.map(m => m.conversationId.toString()));

    // Topic trend over time
    const trend = await Message.aggregate([
      {
        $match: {
          ...dateQuery,
          topics: topicName
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return {
      totalMessages: messages.length,
      uniqueConversations: uniqueConversations.size,
      trend: trend.map(item => ({
        date: item._id,
        count: item.count
      }))
    };
  }
}

export const topicService = new TopicService();

