import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new AnalyticsController();

router.use(authenticate);

// Dashboard & Analytics
router.get('/dashboard', controller.getDashboard);
router.get('/trends', controller.getTrends);
router.get('/performance', controller.getPerformance);
router.get('/export', controller.exportData);

// Topics
router.get('/topics', controller.getAllTopics);
router.get('/topics/:topicId', controller.getTopicById);
router.post('/topics', controller.createTopic);
router.patch('/topics/:topicId', controller.updateTopic);
router.delete('/topics/:topicId', controller.deleteTopic);
router.post('/detect-topics', controller.detectTopics);
router.get('/topics/:topicName/stats', controller.getTopicStats);

export default router;

