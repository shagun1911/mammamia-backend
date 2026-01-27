import { Router } from 'express';
import { outboundAgentConfigController } from '../controllers/outboundAgentConfig.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/outbound-agent-config - Get all outbound agent configs
router.get('/', (req, res, next) => outboundAgentConfigController.getAll(req, res, next));

// GET /api/outbound-agent-config/:outboundNumber - Get config by outbound number
router.get('/:outboundNumber', (req, res, next) => outboundAgentConfigController.getByOutboundNumber(req, res, next));

// PUT /api/outbound-agent-config/:outboundNumber - Create or update outbound agent config
router.put('/:outboundNumber', (req, res, next) => outboundAgentConfigController.createOrUpdate(req, res, next));

// DELETE /api/outbound-agent-config/:outboundNumber - Delete config by outbound number
router.delete('/:outboundNumber', (req, res, next) => outboundAgentConfigController.delete(req, res, next));

export default router;
