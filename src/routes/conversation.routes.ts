import { Router } from 'express';
import { conversationController } from '../controllers/conversation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public widget endpoint (no authentication required)
router.post('/widget', conversationController.saveWidgetConversation);

router.use(authenticate); // All other routes require authentication

router.get('/', conversationController.getAll);
router.get('/search-messages', conversationController.searchMessages);
router.post('/bulk', conversationController.bulkCreate);
router.post('/bulk-delete', conversationController.bulkDelete);
router.get('/transcript/:callerId', conversationController.fetchTranscript);
router.get('/:conversationId', conversationController.getById);
router.post('/:conversationId/messages', conversationController.addMessage);
router.post('/:conversationId/take-control', conversationController.takeControl);
router.post('/:conversationId/release-control', conversationController.releaseControl);
router.patch('/:conversationId/status', conversationController.updateStatus);
router.patch('/:conversationId/assign', conversationController.assignOperator);
router.patch('/:conversationId/labels', conversationController.updateLabels);
router.patch('/:conversationId/folder', conversationController.moveToFolder);
router.delete('/:conversationId', conversationController.delete);

export default router;
