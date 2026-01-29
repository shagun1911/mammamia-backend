import { Router } from 'express';
import { batchCallingController } from '../controllers/batchCalling.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/v1/batch-calling/submit - Submit batch calling job
router.post('/submit', batchCallingController.submitBatchCall);

export default router;
