import { Router } from 'express';
import { inboundAgentConfigController } from '../controllers/inboundAgentConfig.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/inbound-agent-config - Get all inbound agent configs
router.get('/', (req, res, next) => inboundAgentConfigController.get(req, res, next));

// GET /api/inbound-agent-config/:phoneNumber - Get config by phone number
router.get('/:phoneNumber', (req, res, next) => inboundAgentConfigController.getByPhoneNumber(req, res, next));

// POST /api/inbound-agent-config/sync - Sync configs from various settings
router.post('/sync', (req, res, next) => inboundAgentConfigController.sync(req, res, next));

// PUT /api/inbound-agent-config - Update inbound agent config
router.put('/', (req, res, next) => inboundAgentConfigController.update(req, res, next));

// DELETE /api/inbound-agent-config/all - Delete all configs
router.delete('/all', (req, res, next) => inboundAgentConfigController.deleteAll(req, res, next));

// DELETE /api/inbound-agent-config/:phoneNumber - Delete config by phone number
router.delete('/:phoneNumber', (req, res, next) => inboundAgentConfigController.delete(req, res, next));

export default router;

