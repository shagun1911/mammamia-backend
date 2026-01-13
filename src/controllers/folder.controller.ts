import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FolderService } from '../services/folder.service';
import { successResponse } from '../utils/response.util';

export class FolderController {
  private folderService: FolderService;

  constructor() {
    this.folderService = new FolderService();
  }

  getAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const folders = await this.folderService.findAll();
      res.json(successResponse(folders));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const folder = await this.folderService.create(req.body);
      res.status(201).json(successResponse(folder, 'Folder created'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const folder = await this.folderService.update(req.params.folderId, req.body);
      res.json(successResponse(folder, 'Folder updated'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.folderService.delete(req.params.folderId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };
}

export const folderController = new FolderController();

