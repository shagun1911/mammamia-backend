import { Router } from 'express';
import { templateController } from '../controllers/template.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', templateController.getAll);
router.post('/', templateController.create);
router.patch('/:templateId', templateController.update);
router.delete('/:templateId', templateController.delete);

export default router;

