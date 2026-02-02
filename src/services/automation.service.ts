import mongoose from 'mongoose';
import Automation from '../models/Automation';
import AutomationExecution from '../models/AutomationExecution';
import { AutomationEngine } from './automationEngine.service';
import { AppError } from '../middleware/error.middleware';

export class AutomationService {
  private engine: AutomationEngine;

  constructor() {
    this.engine = new AutomationEngine();
  }

  async findAll(organizationId?: string) {
    const query: any = {};
    if (organizationId) {
      query.organizationId = organizationId;
    }
    const automations = await Automation.find(query).sort({ createdAt: -1 }).lean();
    return automations;
  }

  async findById(automationId: string, organizationId: string) {
    const automation = await Automation.findById(automationId).lean();

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    // CRITICAL: Verify ownership - automation must belong to user's organization
    const autoOrgId = (automation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();

    if (autoOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this automation');
    }

    return automation;
  }

  async create(automationData: any) {
    const automation = await Automation.create(automationData);
    return automation;
  }

  async update(automationId: string, automationData: any, organizationId: string) {
    const automation = await Automation.findById(automationId);

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    // CRITICAL: Verify ownership - automation must belong to user's organization
    const autoOrgId = (automation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();

    if (autoOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this automation');
    }

    const updated = await Automation.findByIdAndUpdate(
      automationId,
      automationData,
      { new: true }
    );

    return updated!;
  }

  async delete(automationId: string, organizationId: string) {
    const automation = await Automation.findById(automationId);

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    // CRITICAL: Verify ownership - automation must belong to user's organization
    const autoOrgId = (automation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();

    if (autoOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this automation');
    }

    await automation.deleteOne();
    await AutomationExecution.deleteMany({ automationId });

    return { message: 'Automation deleted successfully' };
  }

  async toggle(automationId: string, isActive: boolean, organizationId: string) {
    const automation = await Automation.findById(automationId);

    if (!automation) {
      throw new AppError(404, 'NOT_FOUND', 'Automation not found');
    }

    // CRITICAL: Verify ownership - automation must belong to user's organization
    const autoOrgId = (automation as any).organizationId?.toString();
    const userOrgId = organizationId.toString();

    if (autoOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this automation');
    }

    const updated = await Automation.findByIdAndUpdate(
      automationId,
      { isActive },
      { new: true }
    );

    return updated!;
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

  async extractConversationData(conversationId: string, extractionType: string, organizationId: string) {
    try {
      // Get Conversation model (use existing if already compiled, otherwise import)
      let Conversation: any;
      try {
        Conversation = mongoose.model('Conversation');
      } catch (e) {
        Conversation = (await import('../models/Conversation')).default;
      }

      // Find conversation
      const conversation = await Conversation.findById(conversationId).lean();

      if (!conversation) {
        return {
          success: false,
          error: 'Conversation not found',
          appointment_booked: false
        };
      }

      // Verify organization ownership
      if (conversation.organizationId?.toString() !== organizationId) {
        return {
          success: false,
          error: 'Unauthorized access to conversation',
          appointment_booked: false
        };
      }

      // Get transcript
      const transcript = conversation.transcript;

      if (!transcript) {
        return {
          success: false,
          error: 'No transcript available',
          appointment_booked: false
        };
      }

      // Extract text from transcript
      let transcriptText = '';

      if (typeof transcript === 'string') {
        transcriptText = transcript;
      } else if (Array.isArray(transcript)) {
        transcriptText = transcript.map((msg: any) => {
          if (typeof msg === 'string') return msg;
          if (msg.text) return msg.text;
          if (msg.message) return msg.message;
          return JSON.stringify(msg);
        }).join('\n');
      } else if (transcript.messages && Array.isArray(transcript.messages)) {
        transcriptText = transcript.messages.map((msg: any) => {
          if (typeof msg === 'string') return msg;
          if (msg.text) return msg.text;
          if (msg.message) return msg.message;
          return JSON.stringify(msg);
        }).join('\n');
      } else {
        transcriptText = JSON.stringify(transcript);
      }

      if (!transcriptText || transcriptText.trim().length === 0) {
        return {
          success: false,
          error: 'Empty transcript',
          appointment_booked: false
        };
      }

      // Use LLM to extract appointment information
      const apiKeysService = (await import('../services/apiKeys.service')).apiKeysService;
      const apiKeyData = await apiKeysService.getApiKeys(organizationId);
      const apiKey = apiKeyData?.apiKey;

      if (!apiKey) {
        return {
          success: false,
          error: 'OpenAI API key not configured',
          appointment_booked: false
        };
      }

      // Call OpenAI to extract appointment data
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });

      const systemPrompt = extractionType === 'appointment'
        ? `You are an AI assistant that extracts appointment information from conversation transcripts.

Analyze the conversation and determine if the customer REQUESTED or PROVIDED appointment details (even if the system failed to confirm it).

Set appointment_booked to TRUE if:
- Customer explicitly said they want to book an appointment
- Customer provided a date and time for the appointment
- Customer gave their name and contact details for the booking

Set appointment_booked to FALSE only if:
- Customer never mentioned wanting an appointment
- Customer explicitly declined or cancelled

IMPORTANT: Even if the agent said "unable to confirm" or "system error", if the customer PROVIDED appointment details (name, date, time), set appointment_booked to TRUE.

Extract:
1. Was an appointment REQUESTED by the customer? (yes/no)
2. Date in YYYY-MM-DD format (convert "4 February" → "2026-02-04", "Feb 5" → "2026-02-05")
3. Time in HH:MM 24-hour format (convert "6 PM" → "18:00", "3 PM" → "15:00", "4 p.m." → "16:00")

Current year: 2026

Respond ONLY with valid JSON:
{
  "appointment_booked": true/false,
  "date": "YYYY-MM-DD" or null,
  "time": "HH:MM" or null,
  "confidence": 0.0-1.0
}`
        : `Extract lead information from the conversation.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversation transcript:\n${transcriptText}` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      const extractedData = JSON.parse(responseText);

      console.log('[Automation Service] Extracted data from conversation:', {
        conversationId,
        extractedData
      });

      return {
        success: true,
        ...extractedData
      };

    } catch (error: any) {
      console.error('[Automation Service] Error extracting conversation data:', error);
      return {
        success: false,
        error: error.message || 'Failed to extract data',
        appointment_booked: false
      };
    }
  }

  async triggerByEvent(event: string, eventData: any, context?: any) {
    return await this.engine.triggerByEvent(event, eventData, context);
  }
}

export const automationService = new AutomationService();
