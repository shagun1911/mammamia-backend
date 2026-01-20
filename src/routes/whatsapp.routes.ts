import { Router } from 'express';
import whatsappController from '../controllers/whatsapp.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All WhatsApp routes require authentication
router.use(authenticate);

// Send WhatsApp template message
router.post('/send-template', whatsappController.sendTemplate.bind(whatsappController));

export default router;

