import { Router } from 'express';
import { emailTemplateController } from '../controllers/emailTemplate.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.post('/', emailTemplateController.createEmailTemplate);
router.get('/', emailTemplateController.getEmailTemplates);
// Update routes must come before parameterized routes
router.post('/update-all-webhooks', emailTemplateController.updateAllTemplatesWebhook);
router.post('/:templateId/update-webhook', emailTemplateController.updateTemplateWebhook);
router.get('/:templateId', emailTemplateController.getEmailTemplateById);
router.delete('/:templateId', emailTemplateController.deleteEmailTemplate);

export default router;

