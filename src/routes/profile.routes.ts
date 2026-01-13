import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { profileController } from '../controllers/profile.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get available profile types
router.get('/available', profileController.getAvailableProfiles);

// Get current profile and usage stats
router.get('/', profileController.getProfile);

// Get usage statistics
router.get('/usage', profileController.getUsageStats);

// Check if user has available credits
router.get('/check-credits', profileController.checkCredits);

// Select or change profile
router.post('/select', profileController.selectProfile);

// Delete profile
router.delete('/', profileController.deleteProfile);

export default router;

