import Folder from '../models/Folder';
import Conversation from '../models/Conversation';
import { AppError } from '../middleware/error.middleware';

export class FolderService {
  // Get all folders with conversation count
  async findAll() {
    const folders = await Folder.find().sort({ createdAt: -1 }).lean();

    const foldersWithCount = await Promise.all(
      folders.map(async (folder: any) => {
        const count = await Conversation.countDocuments({ folderId: folder._id });
        return {
          ...folder,
          conversationCount: count
        };
      })
    );

    return foldersWithCount;
  }

  // Create folder
  async create(folderData: { name: string; color?: string }) {
    // Check if folder name already exists
    const existing = await Folder.findOne({ name: folderData.name });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'Folder with this name already exists');
    }

    const folder = await Folder.create({
      name: folderData.name,
      color: folderData.color || '#6366f1'
    });

    return folder;
  }

  // Update folder
  async update(folderId: string, folderData: { name?: string; color?: string }) {
    const folder = await Folder.findById(folderId);

    if (!folder) {
      throw new AppError(404, 'NOT_FOUND', 'Folder not found');
    }

    // Check if new name conflicts with existing
    if (folderData.name && folderData.name !== folder.name) {
      const existing = await Folder.findOne({ name: folderData.name });
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Folder with this name already exists');
      }
    }

    if (folderData.name) folder.name = folderData.name;
    if (folderData.color) folder.color = folderData.color;

    await folder.save();
    return folder;
  }

  // Delete folder
  async delete(folderId: string) {
    const folder = await Folder.findByIdAndDelete(folderId);

    if (!folder) {
      throw new AppError(404, 'NOT_FOUND', 'Folder not found');
    }

    // Remove folder from all conversations
    await Conversation.updateMany(
      { folderId: folderId },
      { $unset: { folderId: "" } }
    );

    return { message: 'Folder deleted successfully' };
  }
}

export const folderService = new FolderService();

