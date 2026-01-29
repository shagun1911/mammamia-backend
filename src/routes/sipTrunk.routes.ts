import { Router } from 'express';
import { sipTrunkController } from '../controllers/sipTrunk.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/v1/sip-trunk/outbound-call - Initiate outbound call via SIP trunk
router.post('/outbound-call', sipTrunkController.outboundCall);

export default router;
