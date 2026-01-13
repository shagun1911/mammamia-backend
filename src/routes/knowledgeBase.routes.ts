import { Router } from 'express';
import { knowledgeBaseController } from '../controllers/knowledgeBase.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../config/multer';

const router = Router();

router.use(authenticate);

// Knowledge Base
router.get('/', knowledgeBaseController.getAllKnowledgeBases);
router.post('/', upload.fields([
  { name: 'pdf_files', maxCount: 10 },
  { name: 'excel_files', maxCount: 10 }
]), knowledgeBaseController.createKnowledgeBase);
router.delete('/:kbId', knowledgeBaseController.deleteKnowledgeBase);
router.get('/:kbId/space-usage', knowledgeBaseController.getSpaceUsage);

// FAQs
router.get('/:kbId/faqs', knowledgeBaseController.getAllFAQs);
router.post('/:kbId/faqs', knowledgeBaseController.createFAQ);
router.patch('/:kbId/faqs/:faqId', knowledgeBaseController.updateFAQ);
router.delete('/:kbId/faqs/:faqId', knowledgeBaseController.deleteFAQ);
router.post('/:kbId/faqs/import', upload.single('file'), knowledgeBaseController.importFAQs);

// Websites
router.get('/:kbId/websites', knowledgeBaseController.getAllWebsites);
router.post('/:kbId/websites', knowledgeBaseController.addWebsite);
router.post('/:kbId/websites/urls', knowledgeBaseController.addWebsiteURLs);
router.post('/:kbId/websites/:websiteId/update', knowledgeBaseController.updateWebsite);
router.delete('/:kbId/websites/:websiteId', knowledgeBaseController.deleteWebsite);
router.delete('/:kbId/websites/:websiteId/pages/:pageId', knowledgeBaseController.deleteWebsitePage);

// Files
router.get('/:kbId/files', knowledgeBaseController.getAllFiles);
router.post('/:kbId/files', upload.single('file'), knowledgeBaseController.uploadFile);
router.delete('/:kbId/files/:fileId', knowledgeBaseController.deleteFile);

export default router;

