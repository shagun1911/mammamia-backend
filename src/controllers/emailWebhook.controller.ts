import { Request, Response, NextFunction } from 'express';
import EmailTemplate from '../models/EmailTemplate';
import SocialIntegration from '../models/SocialIntegration';
import User from '../models/User';
import { emailService } from '../services/email.service';
import gmailOAuthService from '../services/gmailOAuth.service';
import { AppError } from '../middleware/error.middleware';

/**
 * Handle email webhook from Python/ElevenLabs API when agent invokes the email tool during a call.
 * POST /api/v1/webhook/email/:templateId
 * Body: { to?: string, parameters?: Record<string, string>, conversation_id?: string }
 * 
 * The Python API calls this when the agent uses the confirm_appointment (or other) email template.
 * - to: recipient email (or from customer_info if not provided)
 * - parameters: template params e.g. { customer, Date, time }
 * - conversation_id: for logging/debugging
 */
export class EmailWebhookController {
  handleEmailWebhook = async (req: Request, res: Response, next: NextFunction) => {
    // GUARANTEED ENTRY LOG - FIRST LINE
    const { templateId } = req.params;
    const payload = req.body || {};
    const { to, recipient, parameters = {}, conversation_id } = payload;

    // Extract arguments from payload
    const params = typeof parameters === 'object' && Object.keys(parameters).length > 0
      ? parameters
      : { ...payload };
    delete params.to;
    delete params.recipient;
    delete params.conversation_id;
    delete params.parameters;

    console.log(
      '[TOOL NODE] 🔥 ENTERED TOOL EXECUTION',
      JSON.stringify({
        template_id: templateId, // templateId from URL params
        arguments: params,
        conversation_id
      }, null, 2)
    );

    try {

      if (!templateId) {
        throw new AppError(422, 'VALIDATION_ERROR', 'template_id is required');
      }

      // Find template by Python API template_id
      const template = await EmailTemplate.findOne({ template_id: templateId }).lean();
      if (!template) {
        console.error(`[Email Webhook] Template not found: ${templateId}`);
        throw new AppError(404, 'NOT_FOUND', `Email template ${templateId} not found`);
      }

      const tool_id = (template as any).tool_id;
      const templateName = (template as any).name;
      const templateParams = (template as any).parameters || [];

      // PARAMETER VALIDATION WITH LOGGING - Before any execution
      const missing = templateParams
        .filter((p: any) => p.required === true)
        .filter((p: any) => {
          const paramValue = params[p.name];
          return paramValue == null || paramValue === '' || (typeof paramValue === 'string' && paramValue.trim() === '');
        });

      if (missing.length > 0) {
        console.error('[TOOL NODE ❌ MISSING PARAMS]', {
          tool_id,
          missing: missing.map((m: any) => m.name),
          received: params
        });
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          `Missing required parameters: ${missing.map((m: any) => m.name).join(', ')}`
        );
      }

      // Resolve recipient: to > recipient > parameters.email
      let recipientEmail = (to || recipient || params?.email)?.trim();
      if (!recipientEmail) {
        console.error('[Tool Execution] ❌ No recipient email', {
          tool_id,
          template_name: templateName,
          body: JSON.stringify(req.body),
          conversation_id
        });
        throw new AppError(422, 'VALIDATION_ERROR', 'Recipient email (to or recipient) is required');
      }

      // Render subject and body with template parameters
      const renderTemplate = (str: string, templateParams: Record<string, any>): string => {
        let result = str;
        for (const [key, value] of Object.entries(templateParams)) {
          const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
          result = result.replace(placeholder, String(value ?? '').trim());
        }
        return result;
      };

      const subject = renderTemplate((template as any).subject_template, params);
      const bodyText = renderTemplate((template as any).body_template, params);

      // Use Gmail from Social Integrations (Settings → Socials) if connected
      const templateUserId = (template as any).userId;
      let gmailIntegration = null;
      if (templateUserId) {
        // Try by userId first
        gmailIntegration = await SocialIntegration.findOne({
          userId: templateUserId,
          platform: 'gmail',
          status: 'connected'
        });
        // Fallback: try by organizationId (Gmail is one per org)
        if (!gmailIntegration) {
          const user = await User.findById(templateUserId).select('organizationId').lean();
          const orgId = (user as any)?.organizationId;
          if (orgId) {
            gmailIntegration = await SocialIntegration.findOne({
              organizationId: orgId,
              platform: 'gmail',
              status: 'connected'
            });
          }
        }
      }

      let senderEmail: string | undefined;

      if (gmailIntegration) {
        senderEmail = gmailIntegration.getDecryptedApiKey();
        console.log('[Email Webhook] Sending via Gmail (Social):', {
          templateId,
          from: senderEmail,
          to: recipientEmail,
          subject: subject.substring(0, 50)
        });
        await gmailOAuthService.sendEmail(senderEmail, {
          to: recipientEmail,
          subject,
          body: bodyText
        });
      } else {
        console.log('[Email Webhook] Sending via SMTP (no Gmail connected):', {
          templateId,
          to: recipientEmail,
          subject: subject.substring(0, 50)
        });
        const emailResult = await emailService.sendEmail({
          to: recipientEmail,
          subject,
          text: bodyText,
          html: bodyText.replace(/\n/g, '<br>')
        });
        // Extract sender email from SMTP service if available
        senderEmail = process.env.DEFAULT_SMTP_SENDER_EMAIL || process.env.SMTP_USER;
      }

      // Log successful execution
      console.log('[Tool Execution] ✅ Email sent successfully', {
        tool_id,
        template_name: templateName,
        template_id: templateId,
        sender_email: senderEmail,
        recipient_email: recipientEmail,
        conversation_id
      });

      res.status(200).json({ success: true, message: 'Email sent successfully' });
    } catch (error: any) {
      // Log execution failure
      console.error('[Tool Execution] ❌ Execution failed', {
        error: error.message,
        stack: error.stack,
        template_id: req.params.templateId,
        body: req.body
      });
      next(error);
    }
  };
}

export const emailWebhookController = new EmailWebhookController();
