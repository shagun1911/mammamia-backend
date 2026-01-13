import { Router } from 'express';
import { promptController } from '../controllers/prompt.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/:type', promptController.getCurrentPrompt);
router.patch('/:type', promptController.updatePrompt);
router.post('/:type/revert', promptController.revertPrompt);

export default router;

