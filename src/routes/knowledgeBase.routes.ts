import { Router } from 'express';
import { knowledgeBaseController } from '../controllers/knowledgeBase.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../config/multer';

const router = Router();

router.use(authenticate);

// NEW Unified Knowledge Base System (aligned with /api/v1/knowledge-base)
// IMPORTANT: Specific routes must come before parameterized routes
// List all documents - must come before /:document_id
router.get('/', knowledgeBaseController.listDocuments);

// Create routes
router.post('/ingest', upload.single('file'), knowledgeBaseController.ingestDocument);
router.post('/text', knowledgeBaseController.createFromText);
router.post('/url', knowledgeBaseController.createFromUrl);
router.post('/file', upload.single('file'), knowledgeBaseController.createFromFile);

// Get, Delete single document - parameterized routes come after specific routes
router.get('/:document_id', knowledgeBaseController.getDocument);
router.delete('/:document_id', knowledgeBaseController.deleteDocument);

// Legacy Root POST Fallback (to prevent 404 for old frontend)
router.post('/', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'pdf_files', maxCount: 10 },
  { name: 'excel_files', maxCount: 10 }
]), knowledgeBaseController.handleLegacyCreate);

// LEGACY Knowledge Base (Deprecated - moved to /legacy)
router.get('/legacy/all', knowledgeBaseController.getAllKnowledgeBases);
router.post('/legacy/create', upload.fields([
  { name: 'pdf_files', maxCount: 10 },
  { name: 'excel_files', maxCount: 10 }
]), knowledgeBaseController.createKnowledgeBase);
router.delete('/legacy/:kbId', knowledgeBaseController.deleteKnowledgeBase);
router.get('/legacy/:kbId/space-usage', knowledgeBaseController.getSpaceUsage);

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
