import Template from '../models/Template';
import { AppError } from '../middleware/error.middleware';

export class TemplateService {
  // Get all templates
  async findAll(userId: string) {
    const templates = await Template.find()
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    return templates;
  }

  // Create template
  async create(templateData: any, userId: string) {
    const template = await Template.create({
      ...templateData,
      createdBy: userId
    });

    return template;
  }

  // Update template
  async update(templateId: string, templateData: any, userId: string) {
    const template = await Template.findById(templateId);

    if (!template) {
      throw new AppError(404, 'NOT_FOUND', 'Template not found');
    }

    // Check if user owns the template
    if (template.createdBy.toString() !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only edit your own templates');
    }

    if (templateData.name) template.name = templateData.name;
    if (templateData.text) template.text = templateData.text;
    if (templateData.category) template.category = templateData.category;

    await template.save();
    return template;
  }

  // Delete template
  async delete(templateId: string, userId: string) {
    const template = await Template.findById(templateId);

    if (!template) {
      throw new AppError(404, 'NOT_FOUND', 'Template not found');
    }

    // Check if user owns the template
    if (template.createdBy.toString() !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only delete your own templates');
    }

    await template.deleteOne();
    return { message: 'Template deleted successfully' };
  }
}

export const templateService = new TemplateService();

