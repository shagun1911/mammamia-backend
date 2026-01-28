import axios from 'axios';
import { AppError } from '../middleware/error.middleware';
import EmailTemplate, { IEmailTemplate, IEmailTemplateParameter } from '../models/EmailTemplate';
import mongoose from 'mongoose';

const PYTHON_API_BASE_URL = process.env.PYTHON_API_URL || 'https://elvenlabs-voiceagent.onrender.com';
const TEMPLATE_WEBHOOK_ENDPOINT = process.env.TEMPLATE_WEBHOOK_ENDPOINT || '';

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
    if (!TEMPLATE_WEBHOOK_ENDPOINT || !TEMPLATE_WEBHOOK_ENDPOINT.trim()) {
      throw new AppError(500, 'CONFIGURATION_ERROR', 'TEMPLATE_WEBHOOK_ENDPOINT is not configured in environment variables');
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
      webhook_base_url: TEMPLATE_WEBHOOK_ENDPOINT.trim(),
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
        webhook_base_url: TEMPLATE_WEBHOOK_ENDPOINT.trim(),
        created_at: pythonResponse.created_at,
      });

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
    const result = await EmailTemplate.deleteOne({
      userId: userObjectId,
      _id: templateId,
    });

    if (result.deletedCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Email template not found');
    }
  }
}

export const emailTemplateService = new EmailTemplateService();

