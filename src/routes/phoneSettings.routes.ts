import { Router } from 'express';
import { phoneSettingsController } from '../controllers/phoneSettings.controller';
import { sipTrunkController } from '../controllers/sipTrunk.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Phone settings
router.get('/', phoneSettingsController.get);
router.put('/', phoneSettingsController.update);

// SIP trunk setup - Outbound
router.post('/setup-sip-trunk', sipTrunkController.setupSipTrunk);
// router.post('/create-livekit-trunk', sipTrunkController.createLivekitTrunk); // Commented out
router.post('/create-generic-sip-trunk', sipTrunkController.createGenericSipTrunk);

// SIP trunk setup - Inbound
router.post('/create-inbound-trunk', sipTrunkController.createInboundTrunk);

export default router;

