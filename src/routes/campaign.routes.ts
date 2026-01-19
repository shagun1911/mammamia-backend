import { Router } from 'express';
import { CampaignController } from '../controllers/campaign.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new CampaignController();

router.use(authenticate);

router.get('/', controller.getAll);
router.get('/templates', controller.getTemplates);
router.get('/:campaignId', controller.getById);
router.get('/:campaignId/progress', controller.getProgress);
router.get('/:campaignId/analytics', controller.getAnalytics);
router.post('/', controller.create);
router.patch('/:campaignId', controller.update);
router.delete('/:campaignId', controller.delete);
router.post('/:campaignId/start', controller.start);
router.post('/:campaignId/pause', controller.pause);
router.post('/:campaignId/resume', controller.resume);
router.post('/:campaignId/retry-failed', controller.retryFailed);
router.post('/:campaignId/cancel', controller.cancel);

export default router;

