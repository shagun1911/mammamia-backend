import { Router } from 'express';
import { CampaignController } from '../controllers/campaign.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new CampaignController();

router.use(authenticate);

router.get('/', controller.getAll);
router.get('/templates', controller.getTemplates);
router.get('/:campaignId', controller.getById);
router.post('/', controller.create);
router.patch('/:campaignId', controller.update);
router.delete('/:campaignId', controller.delete);
router.post('/:campaignId/cancel', controller.cancel);
router.post('/:campaignId/start', controller.start);
router.get('/:campaignId/analytics', controller.getAnalytics);

export default router;

