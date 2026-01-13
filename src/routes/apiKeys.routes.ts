import { Router } from 'express';
import { apiKeysController } from '../controllers/apiKeys.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/api-keys - Get API keys
router.get('/', apiKeysController.getApiKeys.bind(apiKeysController));

// PUT /api/api-keys - Update API keys
router.put('/', apiKeysController.updateApiKeys.bind(apiKeysController));

// DELETE /api/api-keys - Delete API keys
router.delete('/', apiKeysController.deleteApiKeys.bind(apiKeysController));

export default router;

