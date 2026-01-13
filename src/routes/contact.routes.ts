import { Router } from 'express';
import { ContactController } from '../controllers/contact.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../config/multer';

const router = Router();
const controller = new ContactController();

router.use(authenticate);

// Contacts
router.get('/', controller.getAll);
router.get('/:contactId', controller.getById);
router.post('/', controller.create);
router.patch('/:contactId', controller.update);
router.delete('/:contactId', controller.delete);
router.post('/bulk-delete', controller.bulkDelete);
router.post('/bulk-add-to-list', controller.bulkAddToList);
router.patch('/:contactId/status', controller.updateStatus);

// Lists
router.get('/lists/all', controller.getAllLists);
router.post('/lists', controller.createList);
router.patch('/lists/:listId', controller.updateList);
router.delete('/lists/:listId', controller.deleteList);
router.post('/lists/:listId/import', upload.single('file'), controller.importCSV);

// Kanban Statuses
router.post('/lists/:listId/statuses', controller.createStatus);
router.patch('/lists/:listId/statuses/:statusId', controller.updateStatusItem);
router.delete('/lists/:listId/statuses/:statusId', controller.deleteStatusItem);

// Custom Properties
router.get('/custom-properties/all', controller.getAllCustomProperties);
router.post('/custom-properties', controller.createCustomProperty);
router.delete('/custom-properties/:propertyId', controller.deleteCustomProperty);

export default router;

