import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Profile from '../models/Profile';
import User from '../models/User';
import redisClient, { isRedisAvailable } from '../config/redis';
import { AppError } from '../middleware/error.middleware';
import { Parser } from 'json2csv';
import { analyticsService as centralizedAnalyticsService } from './analytics/analytics.service';

export class AnalyticsService {
  // Dashboard Metrics
  async getDashboardMetrics(organizationId: string, dateFrom?: string, dateTo?: string) {
    const cacheKey = `dashboard_metrics:${organizationId}:${dateFrom}:${dateTo}`;
    
    // Try to get from cache (only if Redis is available)
    if (isRedisAvailable()) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        // Continue without cache if Redis fails
      }
    }

    const dateQuery: any = { organizationId };
    if (dateFrom || dateTo) {
      dateQuery.createdAt = {};
      if (dateFrom) dateQuery.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateQuery.createdAt.$lte = new Date(dateTo);
    }

    // Total conversations
    const totalConversations = await Conversation.countDocuments(dateQuery);

    // Active conversations
    const activeConversations = await Conversation.countDocuments({
      ...dateQuery,
      status: { $in: ['open', 'unread', 'support_request'] }
    });

    // Closed conversations
    const closedConversations = await Conversation.countDocuments({
      ...dateQuery,
      status: 'closed'
    });

    // AI vs Human managed
    const aiManagedCount = await Conversation.countDocuments({
      ...dateQuery,
      isAiManaging: true
    });

    const humanManagedCount = await Conversation.countDocuments({
      ...dateQuery,
      isAiManaging: false
    });

    // Average response time (in minutes)
    const conversationsWithResponse = await Conversation.find({
      ...dateQuery,
      firstResponseAt: { $exists: true }
    }).select('createdAt firstResponseAt').lean();

    let avgResponseTime = 0;
    if (conversationsWithResponse.length > 0) {
      const totalResponseTime = conversationsWithResponse.reduce((sum, conv) => {
        const responseTime = (conv.firstResponseAt!.getTime() - conv.createdAt.getTime()) / 1000 / 60;
        return sum + responseTime;
      }, 0);
      avgResponseTime = totalResponseTime / conversationsWithResponse.length;
    }

    // Messages sent today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const messagesToday = await Message.countDocuments({
      timestamp: { $gte: today }
    });

    // Get messages today from Redis (real-time counter)
    let messagesTodayCount = messagesToday;
    if (isRedisAvailable()) {
      try {
        const messagesTodayRedis = await redisClient.get('messages_today_count');
        messagesTodayCount = messagesTodayRedis ? parseInt(messagesTodayRedis) : messagesToday;
      } catch (error) {
        // Use database count if Redis fails
      }
    }

    // Conversations by channel (separate Instagram and Facebook from social)
    const conversationsByChannel = await Conversation.aggregate([
      { $match: dateQuery },
      {
        $project: {
          channel: {
            $cond: {
              if: { $eq: ['$channel', 'social'] },
              then: {
                $cond: {
                  if: { $eq: ['$metadata.platform', 'instagram'] },
                  then: 'instagram',
                  else: {
                    $cond: {
                      if: { $eq: ['$metadata.platform', 'facebook'] },
                      then: 'facebook',
                      else: 'social'
                    }
                  }
                }
              },
              else: '$channel'
            }
          }
        }
      },
      { $group: { _id: '$channel', count: { $sum: 1 } } }
    ]);

    const channelBreakdown = conversationsByChannel.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>);

    // Conversations by status
    const conversationsByStatus = await Conversation.aggregate([
      { $match: dateQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const statusBreakdown = conversationsByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>);

    // Reopened conversations (conversations that were closed then reopened)
    const reopenedConversations = await Conversation.countDocuments({
      ...dateQuery,
      status: { $in: ['open', 'unread', 'support_request'] },
      resolvedAt: { $exists: true } // Was resolved but now open again
    });

    // Wrong answers (messages with low confidence or negative feedback)
    // Get conversation IDs first, then check messages
    const conversationIds = await Conversation.find(dateQuery).select('_id').lean();
    const convIds = conversationIds.map(c => c._id);

    const wrongAnswersQuery: any = {
      conversationId: { $in: convIds },
      sender: 'ai'
    };
    if (dateFrom || dateTo) {
      wrongAnswersQuery.timestamp = {};
      if (dateFrom) wrongAnswersQuery.timestamp.$gte = new Date(dateFrom);
      if (dateTo) wrongAnswersQuery.timestamp.$lte = new Date(dateTo);
    }
    wrongAnswersQuery.$or = [
      { 'metadata.confidence': { $lt: 0.5 } },
      { 'metadata.feedback': 'negative' },
      { 'metadata.isWrongAnswer': true }
    ];

    const wrongAnswers = await Message.countDocuments(wrongAnswersQuery);

    // Links clicked (messages containing URLs)
    const linksClickedQuery: any = {
      conversationId: { $in: convIds }
    };
    if (dateFrom || dateTo) {
      linksClickedQuery.timestamp = {};
      if (dateFrom) linksClickedQuery.timestamp.$gte = new Date(dateFrom);
      if (dateTo) linksClickedQuery.timestamp.$lte = new Date(dateTo);
    }
    // Match messages containing URLs (http:// or https://)
    linksClickedQuery.text = { $regex: /https?:\/\/[^\s]+/i };
    // Count all messages with URLs (we'll track clicks separately if needed)
    const linksClicked = await Message.countDocuments(linksClickedQuery);

    // Use centralized analytics service for consistent calculations
    const dateRange = dateFrom || dateTo ? {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined
    } : undefined;

    const orgMetrics = await centralizedAnalyticsService.getOrganizationMetrics(organizationId, dateRange);
    const totalCallMinutes = orgMetrics.callMinutes;
    const chatConversations = orgMetrics.totalConversations;

    const metrics = {
      totalConversations,
      activeConversations,
      closedConversations,
      reopenedConversations,
      wrongAnswers,
      linksClicked,
      aiManaged: aiManagedCount,
      humanManaged: humanManagedCount,
      avgResponseTime: Math.round(avgResponseTime),
      customerSatisfactionScore: null, // Placeholder for future implementation
      messagesToday: messagesTodayCount,
      conversationsByChannel: channelBreakdown,
      conversationsByStatus: statusBreakdown,
      totalCallMinutes: totalCallMinutes, // Use actual conversation data only, no Profile fallback
      totalChatConversations: chatConversations // Use actual conversation data only
    };

    // Cache for 5 minutes (only if Redis is available)
    if (isRedisAvailable()) {
      try {
        await redisClient.setEx(cacheKey, 300, JSON.stringify(metrics));
      } catch (error) {
        // Continue without cache if Redis fails
      }
    }

    return metrics;
  }

  // Conversation Trends
  async getConversationTrends(
    organizationId: string,
    groupBy: 'hour' | 'day' | 'week' | 'month' = 'day',
    dateFrom?: string,
    dateTo?: string
  ) {
    const dateQuery: any = { organizationId, createdAt: {} };
    if (dateFrom) dateQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) dateQuery.createdAt.$lte = new Date(dateTo);

    // Format string for date grouping
    const dateFormat: Record<string, string> = {
      hour: '%Y-%m-%d %H:00',
      day: '%Y-%m-%d',
      week: '%Y-W%V',
      month: '%Y-%m'
    };

    // New conversations over time
    const newConversations = await Conversation.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat[groupBy], date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Messages sent over time
    const messagesSent = await Message.aggregate([
      { $match: { timestamp: dateQuery.createdAt } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat[groupBy], date: '$timestamp' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Response times over time
    const responseTimes = await Conversation.aggregate([
      {
        $match: {
          ...dateQuery,
          firstResponseAt: { $exists: true }
        }
      },
      {
        $project: {
          period: { $dateToString: { format: dateFormat[groupBy], date: '$createdAt' } },
          responseTime: {
            $divide: [
              { $subtract: ['$firstResponseAt', '$createdAt'] },
              60000 // Convert to minutes
            ]
          }
        }
      },
      {
        $group: {
          _id: '$period',
          avgResponseTime: { $avg: '$responseTime' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Resolution rates over time
    const resolutionRates = await Conversation.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat[groupBy], date: '$createdAt' } },
          total: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          _id: 1,
          resolutionRate: {
            $multiply: [{ $divide: ['$resolved', '$total'] }, 100]
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get call minutes trends from phone conversations
    const callMinutesTrend = await Conversation.aggregate([
      {
        $match: {
          ...dateQuery,
          channel: 'phone'
        }
      },
      {
        $project: {
          period: { $dateToString: { format: dateFormat[groupBy], date: '$createdAt' } },
          duration: {
            $cond: {
              if: { $and: [{ $ne: ['$transcript', null] }, { $gt: [{ $ifNull: ['$transcript.duration', 0] }, 0] }] },
              then: { $divide: [{ $ifNull: ['$transcript.duration', 0] }, 60] },
              else: {
                $cond: {
                  if: { $and: ['$updatedAt', '$createdAt'] },
                  then: {
                    $divide: [
                      { $subtract: ['$updatedAt', '$createdAt'] },
                      60000
                    ]
                  },
                  else: 2 // Default 2 minutes
                }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$period',
          minutes: { $sum: { $ceil: '$duration' } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const callMinutesFormatted = callMinutesTrend.map((item: any) => ({
      period: item._id,
      minutes: item.minutes || 0
    }));

    // Fill in missing periods with 0 to match newConversations periods
    const allPeriods = new Set(newConversations.map((item: any) => item._id));
    callMinutesFormatted.forEach((item: any) => allPeriods.add(item.period));
    const callMinutesComplete = Array.from(allPeriods).sort().map((period: any) => {
      const existing = callMinutesFormatted.find((item: any) => item.period === period);
      return existing || { period, minutes: 0 };
    });

    return {
      newConversations: newConversations.map((item: any) => ({
        period: item._id,
        count: item.count
      })),
      messagesSent: messagesSent.map((item: any) => ({
        period: item._id,
        count: item.count
      })),
      responseTimes: responseTimes.map((item: any) => ({
        period: item._id,
        avgResponseTime: Math.round(item.avgResponseTime)
      })),
      resolutionRates: resolutionRates.map((item: any) => ({
        period: item._id,
        resolutionRate: Math.round(item.resolutionRate * 10) / 10
      })),
      callMinutes: callMinutesComplete
    };
  }

  // Performance Metrics
  async getPerformanceMetrics(
    organizationId: string,
    dateFrom?: string,
    dateTo?: string,
    operatorId?: string
  ) {
    const dateQuery: any = { organizationId };
    if (dateFrom || dateTo) {
      dateQuery.createdAt = {};
      if (dateFrom) dateQuery.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateQuery.createdAt.$lte = new Date(dateTo);
    }

    const conversationQuery: any = { ...dateQuery };
    if (operatorId) {
      conversationQuery.assignedOperatorId = operatorId;
    }

    // Average first response time
    const firstResponseTimes = await Conversation.find({
      ...conversationQuery,
      firstResponseAt: { $exists: true }
    }).select('createdAt firstResponseAt').lean();

    let avgFirstResponseTime = 0;
    if (firstResponseTimes.length > 0) {
      const totalTime = firstResponseTimes.reduce((sum, conv) => {
        return sum + (conv.firstResponseAt!.getTime() - conv.createdAt.getTime()) / 1000 / 60;
      }, 0);
      avgFirstResponseTime = totalTime / firstResponseTimes.length;
    }

    // Average resolution time
    const resolutionTimes = await Conversation.find({
      ...conversationQuery,
      resolvedAt: { $exists: true }
    }).select('createdAt resolvedAt').lean();

    let avgResolutionTime = 0;
    if (resolutionTimes.length > 0) {
      const totalTime = resolutionTimes.reduce((sum, conv) => {
        return sum + (conv.resolvedAt!.getTime() - conv.createdAt.getTime()) / 1000 / 60;
      }, 0);
      avgResolutionTime = totalTime / resolutionTimes.length;
    }

    // Conversations per operator
    const conversationsPerOperator = await Conversation.aggregate([
      { $match: { ...dateQuery, assignedOperatorId: { $exists: true } } },
      {
        $group: {
          _id: '$assignedOperatorId',
          totalHandled: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'operator'
        }
      },
      { $unwind: '$operator' },
      {
        $project: {
          operatorId: '$_id',
          operatorName: {
            $concat: ['$operator.firstName', ' ', '$operator.lastName']
          },
          totalHandled: 1,
          resolved: 1,
          resolutionRate: {
            $multiply: [{ $divide: ['$resolved', '$totalHandled'] }, 100]
          }
        }
      },
      { $sort: { totalHandled: -1 } }
    ]);

    // AI vs Human performance
    const aiPerformance = await Conversation.aggregate([
      { $match: { ...dateQuery, isAiManaging: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          }
        }
      }
    ]);

    const humanPerformance = await Conversation.aggregate([
      { $match: { ...dateQuery, isAiManaging: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Busiest hours/days
    const busiestHours = await Conversation.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const busiestDays = await Conversation.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: { $dayOfWeek: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      avgFirstResponseTime: Math.round(avgFirstResponseTime),
      avgResolutionTime: Math.round(avgResolutionTime),
      conversationsPerOperator,
      aiVsHuman: {
        ai: {
          total: aiPerformance[0]?.total || 0,
          resolved: aiPerformance[0]?.resolved || 0,
          resolutionRate: aiPerformance[0]
            ? Math.round((aiPerformance[0].resolved / aiPerformance[0].total) * 100)
            : 0
        },
        human: {
          total: humanPerformance[0]?.total || 0,
          resolved: humanPerformance[0]?.resolved || 0,
          resolutionRate: humanPerformance[0]
            ? Math.round((humanPerformance[0].resolved / humanPerformance[0].total) * 100)
            : 0
        }
      },
      busiestHours: busiestHours.map(item => ({
        hour: `${item._id}:00`,
        count: item.count
      })),
      busiestDays: busiestDays.map(item => ({
        day: dayNames[item._id - 1],
        count: item.count
      }))
    };
  }

  // Export Data
  async exportData(organizationId: string, format: 'csv' | 'json', filters: any = {}) {
    const query: any = { organizationId };
    
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.channel) {
      query.channel = filters.channel;
    }

    const conversations = await Conversation.find(query)
      .populate('customerId', 'name email phone')
      .populate('assignedOperatorId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    // Get messages for each conversation
    const conversationsWithMessages = await Promise.all(
      conversations.map(async (conv: any) => {
        const messages = await Message.find({ conversationId: conv._id })
          .sort({ timestamp: 1 })
          .lean();

        return {
          conversationId: conv._id,
          customer: conv.customerId?.name || 'Unknown',
          customerEmail: conv.customerId?.email || '',
          customerPhone: conv.customerId?.phone || '',
          channel: conv.channel,
          status: conv.status,
          assignedTo: conv.assignedOperatorId
            ? `${conv.assignedOperatorId.firstName} ${conv.assignedOperatorId.lastName}`
            : 'AI',
          isAiManaged: conv.isAiManaging,
          messageCount: messages.length,
          firstMessage: messages[0]?.text || '',
          lastMessage: messages[messages.length - 1]?.text || '',
          createdAt: conv.createdAt,
          resolvedAt: conv.resolvedAt || null
        };
      })
    );

    if (format === 'json') {
      return {
        format: 'json',
        data: conversationsWithMessages
      };
    } else {
      // CSV format
      const fields = [
        'conversationId',
        'customer',
        'customerEmail',
        'customerPhone',
        'channel',
        'status',
        'assignedTo',
        'isAiManaged',
        'messageCount',
        'firstMessage',
        'lastMessage',
        'createdAt',
        'resolvedAt'
      ];

      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(conversationsWithMessages);

      return {
        format: 'csv',
        data: csv
      };
    }
  }

  // Real-time counter methods
  async incrementMessagesToday() {
    if (isRedisAvailable()) {
      try {
        await redisClient.incr('messages_today_count');
      } catch (error) {
        // Silently fail if Redis is unavailable
      }
    }
  }

  async incrementConversationsToday() {
    if (isRedisAvailable()) {
      try {
        await redisClient.incr('conversations_today_count');
      } catch (error) {
        // Silently fail if Redis is unavailable
      }
    }
  }

  async updateActiveConversationsCount(delta: number) {
    if (isRedisAvailable()) {
      try {
        await redisClient.incrBy('active_conversations_count', delta);
      } catch (error) {
        // Silently fail if Redis is unavailable
      }
    }
  }

  async resetDailyCounters() {
    if (isRedisAvailable()) {
      try {
        await redisClient.set('messages_today_count', '0');
        await redisClient.set('conversations_today_count', '0');
      } catch (error) {
        // Silently fail if Redis is unavailable
      }
    }
  }
}

export const analyticsService = new AnalyticsService();

