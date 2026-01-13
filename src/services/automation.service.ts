import Automation from '../models/Automation';
import AutomationExecution from '../models/AutomationExecution';
import { AutomationEngine } from './automationEngine.service';
import { AppError } from '../middleware/error.middleware';

export class AutomationService {
  private engine: AutomationEngine;

  constructor() {
    this.engine = new AutomationEngine();
  }

  async findAll() {
    const automations = await Automation.find().sort({ createdAt: -1 }).lean();
    return automations;
  }

  async findById(automationId: string) {
    const automation = await Automation.findById(automationId).lean();

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    return automation;
  }

  async create(automationData: any) {
    const automation = await Automation.create(automationData);
    return automation;
  }

  async update(automationId: string, automationData: any) {
    const automation = await Automation.findByIdAndUpdate(
      automationId,
      automationData,
      { new: true }
    );

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    return automation;
  }

  async delete(automationId: string) {
    const automation = await Automation.findByIdAndDelete(automationId);

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    await AutomationExecution.deleteMany({ automationId });

    return { message: 'Automation deleted successfully' };
  }

  async toggle(automationId: string, isActive: boolean) {
    const automation = await Automation.findByIdAndUpdate(
      automationId,
      { isActive },
      { new: true }
    );

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    return automation;
  }

  async getExecutionLogs(automationId: string, page = 1, limit = 20, filters: any = {}) {
    const query: any = { automationId };

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.dateFrom || filters.dateTo) {
      query.executedAt = {};
      if (filters.dateFrom) query.executedAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.executedAt.$lte = new Date(filters.dateTo);
    }

    const skip = (page - 1) * limit;
    const total = await AutomationExecution.countDocuments(query);

    const logs = await AutomationExecution.find(query)
      .sort({ executedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return {
      items: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async testAutomation(automationId: string, testData: any) {
    return await this.engine.testAutomation(automationId, testData);
  }

  async triggerAutomation(automationId: string, triggerData: any, context?: any) {
    return await this.engine.executeAutomation(automationId, triggerData, context);
  }

  async triggerByEvent(event: string, eventData: any, context?: any) {
    return await this.engine.triggerByEvent(event, eventData, context);
  }
}

export const automationService = new AutomationService();

