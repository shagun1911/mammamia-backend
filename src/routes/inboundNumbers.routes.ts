import { Router } from 'express';
import { inboundNumberController } from '../controllers/inboundNumber.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/inbound-numbers - Get all inbound numbers (SOURCE OF TRUTH)
router.get('/', (req, res, next) => inboundNumberController.getAll(req, res, next));

// POST /api/v1/inbound-numbers - Create inbound numbers (checks duplicates, reuses trunkId)
router.post('/', (req, res, next) => inboundNumberController.create(req, res, next));

// DELETE /api/v1/inbound-numbers - Clear ALL inbound data for the user
router.delete('/', (req, res, next) => inboundNumberController.deleteAll(req, res, next));

// DELETE /api/v1/inbound-numbers/:phoneNumber - Remove a specific inbound number
router.delete('/:phoneNumber', (req, res, next) => inboundNumberController.delete(req, res, next));

export default router;
