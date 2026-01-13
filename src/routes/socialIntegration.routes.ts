import { Router } from 'express';
import socialIntegrationController from '../controllers/socialIntegration.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all integrations
router.get('/', socialIntegrationController.getAll.bind(socialIntegrationController));

// Get specific platform integration
router.get('/:platform', socialIntegrationController.getByPlatform.bind(socialIntegrationController));

// Connect/update integration
router.post('/:platform/connect', socialIntegrationController.connect.bind(socialIntegrationController));

// Test connection
router.post('/:platform/test', socialIntegrationController.testConnection.bind(socialIntegrationController));

// Disconnect integration
router.post('/:platform/disconnect', socialIntegrationController.disconnect.bind(socialIntegrationController));

// Delete integration
router.delete('/:platform', socialIntegrationController.delete.bind(socialIntegrationController));

export default router;

