import { Router } from 'express';
import whatsappController from '../controllers/whatsapp.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All WhatsApp routes require authentication
router.use(authenticate);

// Send WhatsApp template message
router.post('/send-template', whatsappController.sendTemplate.bind(whatsappController));

// Fetch WhatsApp templates using connected integration (automatic mode)
router.get('/templates', whatsappController.getTemplates.bind(whatsappController));

// Fetch WhatsApp templates using manual credentials (manual mode)
router.post('/templates', whatsappController.getTemplatesManual.bind(whatsappController));

export default router;

