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
      const { page = 1, limit = 20, ...filters } = req.query;
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
      const result = await this.contactService.bulkDelete(req.body.contactIds);
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
      console.log('[CSV Import Controller] First 200 chars:', csvContent.substring(0, 200));
      
      const result = await this.contactService.importFromCSV(
        listId,
        csvContent,
        defaultCountryCode
      );

      console.log('[CSV Import Controller] Import result:', result);
      res.json(successResponse(result, 'Contacts imported'));
    } catch (error) {
      console.error('[CSV Import Controller] Error:', error);
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

