import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AnalyticsService } from '../services/analytics.service';
import { TopicService } from '../services/topic.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';
import Conversation from '../models/Conversation';
import Message from '../models/Message';

export class AnalyticsController {
  private analyticsService: AnalyticsService;
  private topicService: TopicService;

  constructor() {
    this.analyticsService = new AnalyticsService();
    this.topicService = new TopicService();
  }

  // Dashboard Metrics
  getDashboard = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { dateFrom, dateTo, channel } = req.query;
      const metrics = await this.analyticsService.getDashboardMetrics(
        organizationId.toString(),
        dateFrom as string,
        dateTo as string,
        channel as string
      );
      res.json(successResponse(metrics));
    } catch (error) {
      next(error);
    }
  };

  // Conversation Trends
  getTrends = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { groupBy = 'day', dateFrom, dateTo, channel } = req.query;
      const trends = await this.analyticsService.getConversationTrends(
        organizationId.toString(),
        groupBy as 'hour' | 'day' | 'week' | 'month',
        dateFrom as string,
        dateTo as string,
        channel as string
      );
      res.json(successResponse(trends));
    } catch (error) {
      next(error);
    }
  };

  // Performance Metrics
  getPerformance = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { dateFrom, dateTo, operatorId } = req.query;
      const performance = await this.analyticsService.getPerformanceMetrics(
        organizationId.toString(),
        dateFrom as string,
        dateTo as string,
        operatorId as string
      );
      res.json(successResponse(performance));
    } catch (error) {
      next(error);
    }
  };

  // Export Data
  exportData = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { format = 'json', ...filters } = req.query;
      const result = await this.analyticsService.exportData(
        organizationId.toString(),
        format as 'csv' | 'json',
        filters
      );

      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=conversations-export.csv');
        res.send(result.data);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=conversations-export.json');
        res.json(result.data);
      }
    } catch (error) {
      next(error);
    }
  };

  // Topics Management
  getAllTopics = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const topics = await this.topicService.findAll();
      res.json(successResponse(topics));
    } catch (error) {
      next(error);
    }
  };

  getTopicById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const topic = await this.topicService.findById(req.params.topicId);
      res.json(successResponse(topic));
    } catch (error) {
      next(error);
    }
  };

  createTopic = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const topic = await this.topicService.create(req.body);
      res.status(201).json(successResponse(topic, 'Topic created'));
    } catch (error) {
      next(error);
    }
  };

  updateTopic = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const topic = await this.topicService.update(req.params.topicId, req.body);
      res.json(successResponse(topic, 'Topic updated'));
    } catch (error) {
      next(error);
    }
  };

  deleteTopic = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.topicService.delete(req.params.topicId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  detectTopics = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { conversationId, analyzeAll } = req.body;
      const result = await this.topicService.detectTopics(
        conversationId,
        analyzeAll
      );
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  getTopicStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { topicName } = req.params;
      const { dateFrom, dateTo } = req.query;
      const stats = await this.topicService.getTopicStats(
        topicName,
        dateFrom as string,
        dateTo as string
      );
      res.json(successResponse(stats));
    } catch (error) {
      next(error);
    }
  };

  // Get top topics for analytics
  getTopTopics = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { dateFrom, dateTo, limit = 10 } = req.query;

      // Get conversations in date range
      const dateQuery: any = { organizationId };
      if (dateFrom || dateTo) {
        dateQuery.createdAt = {};
        if (dateFrom) dateQuery.createdAt.$gte = new Date(dateFrom as string);
        if (dateTo) dateQuery.createdAt.$lte = new Date(dateTo as string);
      }

      // Apply channel filter
      const { channel } = req.query;
      if (channel && channel !== 'all') {
        if (channel === 'instagram' || channel === 'facebook') {
          dateQuery.channel = 'social';
          dateQuery['metadata.platform'] = channel;
        } else {
          dateQuery.channel = channel;
        }
      }

      const conversations = await Conversation.find(dateQuery).select('_id').lean();
      const conversationIds = conversations.map(c => c._id);

      // Aggregate topics from messages
      const topics = await Message.aggregate([
        {
          $match: {
            conversationId: { $in: conversationIds },
            topics: { $exists: true, $ne: [] }
          }
        },
        { $unwind: '$topics' },
        {
          $group: {
            _id: '$topics',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: parseInt(limit as string) }
      ]);

      const topTopics = topics.map((item: any) => ({
        topic: item._id,
        count: item.count
      }));

      res.json(successResponse(topTopics));
    } catch (error) {
      next(error);
    }
  };
}

export const analyticsController = new AnalyticsController();

