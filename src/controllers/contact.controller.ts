import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ContactService } from '../services/contact.service';
import { successResponse, paginatedResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

export class ContactController {
  private contactService: ContactService;

  constructor() {
    this.contactService = new ContactService();
  }

  // ===== Contacts =====

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const { page = 1, limit = 30, ...filters } = req.query;
      const result = await this.contactService.findAll(
        organizationId.toString(),
        filters,
        Number(page),
        Number(limit)
      );
      res.json(paginatedResponse(
        result.items,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total
      ));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const contact = await this.contactService.findById(req.params.contactId, organizationId.toString());
      res.json(successResponse(contact));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Get organizationId from user
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      // Add organizationId to contact data
      const contactData = {
        ...req.body,
        organizationId: organizationId.toString()
      };

      const contact = await this.contactService.create(contactData);
      res.status(201).json(successResponse(contact, 'Contact created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const contact = await this.contactService.update(req.params.contactId, req.body, organizationId.toString());
      res.json(successResponse(contact, 'Contact updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const result = await this.contactService.delete(req.params.contactId, organizationId.toString());
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  bulkDelete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const result = await this.contactService.bulkDelete(req.body.contactIds, organizationId.toString());
      res.json(successResponse(result, 'Contacts deleted'));
    } catch (error) {
      next(error);
    }
  };

  bulkAddToList = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { contactIds, listId } = req.body;
      const result = await this.contactService.bulkAddToList(contactIds, listId);
      res.json(successResponse(result, 'Contacts added to list'));
    } catch (error) {
      next(error);
    }
  };

  importCSV = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      console.log('[CSV Import Controller] Request received');
      console.log('[CSV Import Controller] Params:', req.params);
      console.log('[CSV Import Controller] File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE');

      if (!req.file) {
        throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
      }

      const { listId } = req.params;
      const { defaultCountryCode = '+1' } = req.body;

      console.log('[CSV Import Controller] List ID:', listId);
      console.log('[CSV Import Controller] Country Code:', defaultCountryCode);

      const csvContent = req.file.buffer.toString('utf-8');
      console.log('[CSV Import Controller] CSV Content length:', csvContent.length);

      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }

      const userId = req.user?._id?.toString() || '';
      const orgId = organizationId.toString();

      // Count total rows efficiently (streaming, no full file load)
      // Fast row count: count newlines (excluding header)
      const totalRows = Math.max(0, csvContent.split('\n').length - 1);
      console.log('[CSV Import Controller] Estimated total rows:', totalRows);

      // Check if queue is available (for large imports)
      // Import queue to check availability
      const { csvImportQueue } = await import('../queues/csvImport.queue');
      
      console.log('[CSV Import Controller] Queue available:', !!csvImportQueue);
      console.log('[CSV Import Controller] Total rows:', totalRows, 'Threshold:', 1000);
      
      // Always create import record for progress tracking (even for sync imports)
      const CSVImport = (await import('../models/CSVImport')).default;
      const importRecord = await CSVImport.create({
        userId,
        organizationId: orgId,
        listId,
        filename: req.file.originalname,
        fileSize: req.file.size,
        totalRows,
        status: 'processing'
      });

      console.log('[CSV Import Controller] Created import record:', importRecord._id.toString());

      // If no queue or small file, use synchronous import
      // IMPORTANT: Always use synchronous import if queue is not available
      if (!csvImportQueue || totalRows <= 1000) {
        console.log('[CSV Import Controller] Using synchronous import');
        console.log('[CSV Import Controller] Reason:', !csvImportQueue ? 'Queue unavailable (Redis not connected)' : 'Small file (≤1000 rows)');
        
        try {
          // Update import record as processing
          importRecord.startedAt = new Date();
          await importRecord.save();

          const result = await this.contactService.importFromCSV(
            listId,
            csvContent,
            defaultCountryCode,
            userId,
            orgId
          );

          // Update import record with results
          importRecord.status = 'completed';
          importRecord.completedAt = new Date();
          importRecord.processedRows = totalRows;
          importRecord.importedCount = result.imported || 0;
          importRecord.duplicateCount = result.duplicates || 0;
          importRecord.failedCount = result.failed || 0;
          importRecord.importErrors = result.errors || [];
          await importRecord.save();

          console.log('[CSV Import Controller] Import result:', result);
          res.json(successResponse({
            importId: importRecord._id.toString(),
            imported: result.imported || 0,
            duplicates: result.duplicates || 0,
            failed: result.failed || 0,
            totalRows: importRecord.totalRows,
            status: 'completed'
          }, 'Contacts imported'));
        } catch (error: any) {
          // Update import record with error
          importRecord.status = 'failed';
          importRecord.completedAt = new Date();
          importRecord.failedCount = totalRows;
          importRecord.importErrors = [{ row: 0, error: error.message || 'Import failed' }];
          await importRecord.save();
          throw error;
        }
        return;
      }
      
      // Use queue for large imports (>1000 rows)
      if (totalRows > 1000) {
        console.log('[CSV Import Controller] Using queue for large import');

        // Queue the import job
        try {
          const job = await csvImportQueue.add('import-csv', {
            importId: importRecord._id.toString(),
            csvContent,
            listId,
            defaultCountryCode,
            userId,
            organizationId: orgId
          }, {
            attempts: 1,
            removeOnComplete: false,
            removeOnFail: false
          });

          console.log('[CSV Import Controller] Queued import job:', job.id, 'for import:', importRecord._id.toString());
          
          res.json(successResponse({
            importId: importRecord._id.toString(),
            status: 'queued',
            totalRows,
            message: 'Import queued. Use /contacts/imports/:importId to check progress.'
          }, 'CSV import queued'));
        } catch (queueError: any) {
          console.error('[CSV Import Controller] Failed to queue job:', queueError);
          // Fallback to synchronous import if queue fails
          console.log('[CSV Import Controller] Falling back to synchronous import');
          const result = await this.contactService.importFromCSV(
            listId,
            csvContent,
            defaultCountryCode,
            userId,
            orgId
          );
          res.json(successResponse(result, 'Contacts imported (synchronous fallback)'));
        }
      }
    } catch (error) {
      console.error('[CSV Import Controller] Error:', error);
      next(error);
    }
  };

  getImportStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { importId } = req.params;
      const CSVImport = (await import('../models/CSVImport')).default;
      
      const importRecord = await CSVImport.findById(importId);
      if (!importRecord) {
        throw new AppError(404, 'NOT_FOUND', 'Import not found');
      }

      // Verify ownership
      const userId = req.user?._id?.toString() || '';
      if (importRecord.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      const progress = importRecord.totalRows > 0 
        ? Math.round((importRecord.processedRows / importRecord.totalRows) * 100)
        : 0;

      res.json(successResponse({
        importId: importRecord._id.toString(),
        status: importRecord.status,
        progress,
        totalRows: importRecord.totalRows,
        processedRows: importRecord.processedRows,
        importedCount: importRecord.importedCount,
        failedCount: importRecord.failedCount,
        duplicateCount: importRecord.duplicateCount,
        errors: importRecord.importErrors,
        startedAt: importRecord.startedAt,
        completedAt: importRecord.completedAt,
        createdAt: importRecord.createdAt
      }, 'Import status retrieved'));
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { contactId } = req.params;
      const { listId, statusId } = req.body;
      const result = await this.contactService.updateContactStatus(contactId, listId, statusId);
      res.json(successResponse(result, 'Contact status updated'));
    } catch (error) {
      next(error);
    }
  };

  // ===== Lists =====

  getAllLists = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const lists = await this.contactService.findAllLists(organizationId.toString());
      res.json(successResponse(lists));
    } catch (error) {
      next(error);
    }
  };

  createList = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const list = await this.contactService.createList(organizationId.toString(), req.body);
      res.status(201).json(successResponse(list, 'List created'));
    } catch (error) {
      next(error);
    }
  };

  updateList = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const list = await this.contactService.updateList(req.params.listId, req.body);
      res.json(successResponse(list, 'List updated'));
    } catch (error) {
      next(error);
    }
  };

  deleteList = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.contactService.deleteList(req.params.listId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  deleteAllContactsFromList = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const result = await this.contactService.deleteAllContactsFromList(
        req.params.listId,
        organizationId.toString()
      );
      res.json(successResponse(result, 'All contacts deleted from list'));
    } catch (error) {
      next(error);
    }
  };

  // ===== Kanban Statuses =====

  createStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const list = await this.contactService.createStatus(req.params.listId, req.body);
      res.status(201).json(successResponse(list, 'Status created'));
    } catch (error) {
      next(error);
    }
  };

  updateStatusItem = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { listId, statusId } = req.params;
      const list = await this.contactService.updateStatus(listId, statusId, req.body);
      res.json(successResponse(list, 'Status updated'));
    } catch (error) {
      next(error);
    }
  };

  deleteStatusItem = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { listId, statusId } = req.params;
      const result = await this.contactService.deleteStatus(listId, statusId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  // ===== Custom Properties =====

  getAllCustomProperties = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Use organizationId if available, otherwise fall back to userId
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Organization ID not found');
      }
      const properties = await this.contactService.findAllCustomProperties(organizationId.toString());
      res.json(successResponse(properties));
    } catch (error) {
      next(error);
    }
  };

  createCustomProperty = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const property = await this.contactService.createCustomProperty(req.body);
      res.status(201).json(successResponse(property, 'Custom property created'));
    } catch (error) {
      next(error);
    }
  };

  deleteCustomProperty = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.contactService.deleteCustomProperty(req.params.propertyId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };
}

export const contactController = new ContactController();

