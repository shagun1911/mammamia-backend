import { Router } from 'express';
import { AutomationController } from '../controllers/automation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new AutomationController();

router.use(authenticate);

router.get('/', controller.getAll);
router.get('/:automationId', controller.getById);
router.post('/', controller.create);
router.patch('/:automationId', controller.update);
router.delete('/:automationId', controller.delete);
router.patch('/:automationId/toggle', controller.toggle);
router.get('/:automationId/logs', controller.getExecutionLogs);
router.post('/:automationId/test', controller.test);
router.post('/:automationId/trigger', controller.trigger);
router.post('/trigger-event', controller.triggerByEvent);

export default router;

