import axios from 'axios';
import { AppError } from '../middleware/error.middleware';
import EmailTemplate, { IEmailTemplate, IEmailTemplateParameter } from '../models/EmailTemplate';
import mongoose from 'mongoose';

const PYTHON_API_BASE_URL = process.env.PYTHON_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

/**
 * Base URL for the email webhook - the Python/ElevenLabs API calls this when the agent invokes the email tool.
 * 
 * IMPORTANT: For Gmail from Socials to work, webhook MUST reach our backend. Set TEMPLATE_WEBHOOK_ENDPOINT
 * to your deployed backend URL (e.g. https://aisteinai-backend-2026.onrender.com). Then recreate the template.
 * 
 * Priority: TEMPLATE_WEBHOOK_ENDPOINT > NGROK_BASE_URL > BACKEND_URL > PYTHON_API_URL (fallback, uses SMTP)
 */
function getTemplateWebhookEndpoint(): string {
  const explicit = process.env.TEMPLATE_WEBHOOK_ENDPOINT?.trim();
  if (explicit) {
    const url = explicit.endsWith('/api/v1') ? explicit : `${explicit.replace(/\/$/, '')}/api/v1`;
    console.log('[EmailTemplate Service] Using TEMPLATE_WEBHOOK_ENDPOINT (Gmail from Socials will work):', url);
    return url;
  }
  
  const ngrok = process.env.NGROK_BASE_URL?.trim();
  if (ngrok) return ngrok.endsWith('/api/v1') ? ngrok : `${ngrok.replace(/\/$/, '')}/api/v1`;
  
  const backend = process.env.BACKEND_URL?.trim();
  if (backend && !backend.includes('localhost') && !backend.includes('127.0.0.1')) {
    return backend.endsWith('/api/v1') ? backend : `${backend.replace(/\/$/, '')}/api/v1`;
  }
  
  const pythonUrl = (process.env.PYTHON_API_URL || process.env.COMM_API_URL || 'https://elvenlabs-voiceagent.onrender.com').replace(/\/$/, '');
  const pythonBase = pythonUrl.endsWith('/api/v1') ? pythonUrl : `${pythonUrl}/api/v1`;
  console.log('[EmailTemplate Service] Using PYTHON_API_URL for webhook - Gmail from Socials will NOT work (use TEMPLATE_WEBHOOK_ENDPOINT)');
  return pythonBase;
}

export interface CreateEmailTemplateRequest {
  name: string;
  description: string;
  subject_template: string;
  body_template: string;
  parameters: IEmailTemplateParameter[];
}

export interface CreateEmailTemplateResponse {
  template_id: string;
  name: string;
  description: string;
  subject_template: string;
  body_template: string;
  parameters: IEmailTemplateParameter[];
  tool_id: string;
  created_at: string;
}

export class EmailTemplateService {
  async createEmailTemplate(userId: string, data: CreateEmailTemplateRequest): Promise<IEmailTemplate> {
    // Validate required fields
    if (!data.name || !data.name.trim()) {
      throw new AppError(422, 'VALIDATION_ERROR', 'name is required');
    }
    if (!data.description || !data.description.trim()) {
      throw new AppError(422, 'VALIDATION_ERROR', 'description is required');
    }
    if (!data.subject_template || !data.subject_template.trim()) {
      throw new AppError(422, 'VALIDATION_ERROR', 'subject_template is required');
    }
    if (!data.body_template || !data.body_template.trim()) {
      throw new AppError(422, 'VALIDATION_ERROR', 'body_template is required');
    }
    const webhookBaseUrl = getTemplateWebhookEndpoint();
    if (!webhookBaseUrl) {
      throw new AppError(500, 'CONFIGURATION_ERROR', 'Could not determine webhook URL. Set TEMPLATE_WEBHOOK_ENDPOINT, NGROK_BASE_URL, or BACKEND_URL in environment variables');
    }
    if (!Array.isArray(data.parameters)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'parameters must be an array');
    }

    // Validate parameters
    for (const param of data.parameters) {
      if (!param.name || !param.name.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', 'All parameters must have a name');
      }
      if (!param.description || !param.description.trim()) {
        throw new AppError(422, 'VALIDATION_ERROR', `Parameter ${param.name} must have a description`);
      }
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Check if template with same name already exists for this user
    const existingTemplate = await EmailTemplate.findOne({
      userId: userObjectId,
      name: data.name.trim(),
    });

    if (existingTemplate) {
      throw new AppError(409, 'DUPLICATE_ERROR', `Email template with name "${data.name}" already exists`);
    }

    // Call Python API
    const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/email-templates`;
    
    const requestBody = {
      name: data.name.trim(),
      description: data.description.trim(),
      subject_template: data.subject_template.trim(),
      body_template: data.body_template.trim(),
      parameters: data.parameters.map(p => ({
        name: p.name.trim(),
        description: p.description.trim(),
        required: p.required || false,
      })),
      webhook_base_url: webhookBaseUrl,
    };

    console.log('\n========== EMAIL TEMPLATE CREATION ==========');
    console.log(`[EmailTemplate Service] Endpoint: ${pythonUrl}`);
    console.log(`[EmailTemplate Service] Method: POST`);
    console.log(`[EmailTemplate Service] Payload:`, JSON.stringify(requestBody, null, 2));
    console.log('==============================================\n');

    try {
      const response = await axios.post<CreateEmailTemplateResponse>(pythonUrl, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      const pythonResponse = response.data;
      console.log(`[EmailTemplate Service] Python API response:`, pythonResponse);

      // Store in database
      const template = await EmailTemplate.create({
        userId: userObjectId,
        template_id: pythonResponse.template_id,
        name: pythonResponse.name,
        description: pythonResponse.description,
        subject_template: pythonResponse.subject_template,
        body_template: pythonResponse.body_template,
        parameters: pythonResponse.parameters,
        tool_id: pythonResponse.tool_id,
        webhook_base_url: webhookBaseUrl,
        created_at: pythonResponse.created_at,
      });

      // 🔑 CRITICAL: Automatically inject tool_id into all existing agents for this user
      // This ensures email templates are available during outbound calls
      try {
        const { agentService } = await import('./agent.service');
        await agentService.addEmailTemplateToolIdToAllAgents(userId, pythonResponse.tool_id);
        console.log(`[EmailTemplate Service] ✅ Injected tool_id ${pythonResponse.tool_id} into all agents for user ${userId}`);
      } catch (error: any) {
        console.error(`[EmailTemplate Service] ⚠️ Failed to inject tool_id into agents:`, error.message);
        // Don't throw - template creation succeeded, agent update is a background operation
      }

      return template;
    } catch (error: any) {
      console.error('[EmailTemplate Service] Failed to create email template in Python API:', error);
      
      if (error.response) {
        console.error('[EmailTemplate Service] Python API error response:', {
          status: error.response.status,
          data: error.response.data,
        });
        throw new AppError(
          error.response.status || 500,
          'EMAIL_TEMPLATE_CREATION_ERROR',
          error.response.data?.detail || error.response.data?.message || 'Failed to create email template in Python API'
        );
      }
      
      throw new AppError(
        500,
        'EMAIL_TEMPLATE_CREATION_ERROR',
        error.message || 'Failed to create email template'
      );
    }
  }

  async getEmailTemplatesByUserId(userId: string): Promise<IEmailTemplate[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const templates = await EmailTemplate.find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .lean();
    return templates as unknown as IEmailTemplate[];
  }

  async getEmailTemplateById(userId: string, templateId: string): Promise<IEmailTemplate | null> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const template = await EmailTemplate.findOne({
      userId: userObjectId,
      _id: templateId,
    }).lean();
    return template as unknown as IEmailTemplate | null;
  }

  async getEmailTemplateByTemplateId(userId: string, templateId: string): Promise<IEmailTemplate | null> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const template = await EmailTemplate.findOne({
      userId: userObjectId,
      template_id: templateId,
    }).lean();
    return template as unknown as IEmailTemplate | null;
  }

  async deleteEmailTemplate(userId: string, templateId: string): Promise<void> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // First, try to find the template - handle both MongoDB _id and template_id (Python API ID)
    // Check if templateId is a valid MongoDB ObjectId
    let template = null;
    let query: any = { userId: userObjectId };
    
    if (mongoose.Types.ObjectId.isValid(templateId) && templateId.length === 24) {
      // It's a valid MongoDB ObjectId, try to find by _id
      query._id = templateId;
      template = await EmailTemplate.findOne(query).lean();
    }
    
    // If not found by _id, try to find by template_id (Python API ID)
    if (!template) {
      query = { userId: userObjectId, template_id: templateId };
      template = await EmailTemplate.findOne(query).lean();
    }

    if (!template) {
      throw new AppError(404, 'NOT_FOUND', 'Email template not found');
    }

    const toolId = (template as any).tool_id;
    const mongoId = (template as any)._id;

    // Delete the template from database using the MongoDB _id
    // We must use _id for deletion, not template_id
    if (!mongoId) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Template found but missing MongoDB _id');
    }

    const result = await EmailTemplate.deleteOne({
      userId: userObjectId,
      _id: mongoId,
    });

    if (result.deletedCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Email template not found');
    }

    // 🔑 CRITICAL: Automatically remove tool_id from all existing agents for this user
    // This ensures deleted email templates are no longer available during outbound calls
    if (toolId) {
      try {
        const { agentService } = await import('./agent.service');
        await agentService.removeEmailTemplateToolIdFromAllAgents(userId, toolId);
        console.log(`[EmailTemplate Service] ✅ Removed tool_id ${toolId} from all agents for user ${userId}`);
      } catch (error: any) {
        console.error(`[EmailTemplate Service] ⚠️ Failed to remove tool_id from agents:`, error.message);
        // Don't throw - template deletion succeeded, agent update is a background operation
      }
    }
  }
}

export const emailTemplateService = new EmailTemplateService();

