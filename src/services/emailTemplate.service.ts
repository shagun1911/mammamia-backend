import axios from 'axios';
import { AppError } from '../middleware/error.middleware';
import EmailTemplate, { IEmailTemplate, IEmailTemplateParameter } from '../models/EmailTemplate';
import mongoose from 'mongoose';

const PYTHON_API_BASE_URL = process.env.PYTHON_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

/**
 * Get webhook endpoint from environment variable.
 * ALWAYS uses TEMPLATE_WEBHOOK_ENDPOINT - fails fast if not configured.
 * Client input is IGNORED - webhook_base_url is always enforced from ENV.
 */
function getTemplateWebhookEndpoint(): string {
  const webhookBaseUrl = process.env.TEMPLATE_WEBHOOK_ENDPOINT?.trim();
  
  if (!webhookBaseUrl) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'TEMPLATE_WEBHOOK_ENDPOINT is not configured in environment variables. This is required for email template webhooks.'
    );
  }
  
  // Ensure URL ends with /api/v1
  const url = webhookBaseUrl.endsWith('/api/v1') 
    ? webhookBaseUrl 
    : `${webhookBaseUrl.replace(/\/$/, '')}/api/v1`;
  
  console.log('[Email Template] Webhook endpoint enforced:', url);
  
  return url;
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
    // ALWAYS enforce webhook URL from ENV - ignore any client input
    const webhookBaseUrl = getTemplateWebhookEndpoint();
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

  /**
   * Update webhook_base_url for all existing email templates to use TEMPLATE_WEBHOOK_ENDPOINT.
   * This fixes templates that were created with incorrect or stale webhook URLs.
   */
  async updateAllTemplatesWebhookUrl(): Promise<{ updated: number; failed: number }> {
    const webhookBaseUrl = getTemplateWebhookEndpoint();
    
    console.log('[Email Template] Updating webhook URLs for all templates to:', webhookBaseUrl);
    
    let updated = 0;
    let failed = 0;
    
    try {
      const templates = await EmailTemplate.find({}).lean();
      
      for (const template of templates) {
        try {
          const templateId = (template as any).template_id;
          const currentWebhook = (template as any).webhook_base_url;
          
          // Skip if already correct
          if (currentWebhook === webhookBaseUrl) {
            continue;
          }
          
          // Update in database
          await EmailTemplate.updateOne(
            { _id: (template as any)._id },
            { $set: { webhook_base_url: webhookBaseUrl } }
          );
          
          // Update in Python API if template_id exists
          if (templateId) {
            try {
              const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/email-templates/${templateId}`;
              await axios.patch(pythonUrl, {
                webhook_base_url: webhookBaseUrl
              }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
              });
              console.log(`[Email Template] ✅ Updated webhook for template ${templateId}`);
            } catch (pythonError: any) {
              console.error(`[Email Template] ⚠️ Failed to update Python API for template ${templateId}:`, pythonError.message);
              // Continue - DB update succeeded
            }
          }
          
          updated++;
        } catch (error: any) {
          console.error(`[Email Template] ⚠️ Failed to update template ${(template as any)._id}:`, error.message);
          failed++;
        }
      }
      
      console.log(`[Email Template] ✅ Updated ${updated} templates, ${failed} failed`);
      return { updated, failed };
    } catch (error: any) {
      console.error('[Email Template] ❌ Failed to update templates:', error.message);
      throw new AppError(500, 'UPDATE_ERROR', `Failed to update template webhook URLs: ${error.message}`);
    }
  }

  /**
   * Update webhook_base_url for a specific email template.
   */
  async updateTemplateWebhookUrl(userId: string, templateId: string): Promise<IEmailTemplate> {
    const webhookBaseUrl = getTemplateWebhookEndpoint();
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // Find template
    let template = null;
    let query: any = { userId: userObjectId };
    
    if (mongoose.Types.ObjectId.isValid(templateId) && templateId.length === 24) {
      query._id = templateId;
      template = await EmailTemplate.findOne(query);
    }
    
    if (!template) {
      query = { userId: userObjectId, template_id: templateId };
      template = await EmailTemplate.findOne(query);
    }
    
    if (!template) {
      throw new AppError(404, 'NOT_FOUND', 'Email template not found');
    }
    
    const pythonTemplateId = (template as any).template_id;
    
    // Update in database
    (template as any).webhook_base_url = webhookBaseUrl;
    await template.save();
    
    // Update in Python API
    if (pythonTemplateId) {
      try {
        const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/email-templates/${pythonTemplateId}`;
        await axios.patch(pythonUrl, {
          webhook_base_url: webhookBaseUrl
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        });
        console.log(`[Email Template] ✅ Updated webhook for template ${pythonTemplateId} in Python API`);
      } catch (pythonError: any) {
        console.error(`[Email Template] ⚠️ Failed to update Python API:`, pythonError.message);
        // Don't throw - DB update succeeded
      }
    }
    
    console.log(`[Email Template] ✅ Updated webhook URL for template ${templateId}`);
    return template;
  }
}

export const emailTemplateService = new EmailTemplateService();

