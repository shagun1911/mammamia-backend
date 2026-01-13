import { Router } from 'express';
import { folderController } from '../controllers/folder.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', folderController.getAll);
router.post('/', folderController.create);
router.patch('/:folderId', folderController.update);
router.delete('/:folderId', folderController.delete);

export default router;

