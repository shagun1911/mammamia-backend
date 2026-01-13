import Label from '../models/Label';
import Conversation from '../models/Conversation';
import { AppError } from '../middleware/error.middleware';

export class LabelService {
  // Get all labels with conversation count
  async findAll() {
    const labels = await Label.find().sort({ createdAt: -1 }).lean();

    const labelsWithCount = await Promise.all(
      labels.map(async (label: any) => {
        const count = await Conversation.countDocuments({ 
          labels: label.name 
        });
        return {
          ...label,
          conversationCount: count
        };
      })
    );

    return labelsWithCount;
  }

  // Create label
  async create(labelData: { name: string; color?: string }) {
    // Check if label name already exists
    const existing = await Label.findOne({ name: labelData.name });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'Label with this name already exists');
    }

    const label = await Label.create({
      name: labelData.name,
      color: labelData.color || '#6366f1'
    });

    return label;
  }

  // Update label
  async update(labelId: string, labelData: { name?: string; color?: string }) {
    const label = await Label.findById(labelId);

    if (!label) {
      throw new AppError(404, 'NOT_FOUND', 'Label not found');
    }

    const oldName = label.name;

    // Check if new name conflicts with existing
    if (labelData.name && labelData.name !== label.name) {
      const existing = await Label.findOne({ name: labelData.name });
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Label with this name already exists');
      }
    }

    if (labelData.name) {
      label.name = labelData.name;
      
      // Update label name in all conversations
      await Conversation.updateMany(
        { labels: oldName },
        { $set: { "labels.$": labelData.name } }
      );
    }

    if (labelData.color) label.color = labelData.color;

    await label.save();
    return label;
  }

  // Delete label
  async delete(labelId: string) {
    const label = await Label.findByIdAndDelete(labelId);

    if (!label) {
      throw new AppError(404, 'NOT_FOUND', 'Label not found');
    }

    // Remove label from all conversations
    await Conversation.updateMany(
      { labels: label.name },
      { $pull: { labels: label.name } }
    );

    return { message: 'Label deleted successfully' };
  }
}

export const labelService = new LabelService();

