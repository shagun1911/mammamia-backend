import { Router } from 'express';
import { labelController } from '../controllers/label.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', labelController.getAll);
router.post('/', labelController.create);
router.patch('/:labelId', labelController.update);
router.delete('/:labelId', labelController.delete);

export default router;

