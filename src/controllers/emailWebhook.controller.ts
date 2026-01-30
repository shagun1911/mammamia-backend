import { Request, Response, NextFunction } from 'express';
import EmailTemplate from '../models/EmailTemplate';
import { emailService } from '../services/email.service';
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
    try {
      const { templateId } = req.params;
      const payload = req.body || {};
      const { to, recipient, parameters = {}, conversation_id } = payload;

      // Parameters might be at top level (e.g. { customer, Date, time }) or in parameters object
      const params = typeof parameters === 'object' && Object.keys(parameters).length > 0
        ? parameters
        : { ...payload };
      delete params.to;
      delete params.recipient;
      delete params.conversation_id;
      delete params.parameters;

      if (!templateId) {
        throw new AppError(422, 'VALIDATION_ERROR', 'template_id is required');
      }

      // Find template by Python API template_id
      const template = await EmailTemplate.findOne({ template_id: templateId }).lean();
      if (!template) {
        console.error(`[Email Webhook] Template not found: ${templateId}`);
        throw new AppError(404, 'NOT_FOUND', `Email template ${templateId} not found`);
      }

      // Resolve recipient: to > recipient > parameters.email
      let recipientEmail = (to || recipient || params?.email)?.trim();
      if (!recipientEmail) {
        console.error('[Email Webhook] No recipient email. Body:', JSON.stringify(req.body));
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

      console.log('[Email Webhook] Sending email:', {
        templateId,
        to: recipientEmail,
        subject: subject.substring(0, 50),
        conversation_id
      });

      await emailService.sendEmail({
        to: recipientEmail,
        subject,
        text: bodyText,
        html: bodyText.replace(/\n/g, '<br>')
      });

      res.status(200).json({ success: true, message: 'Email sent successfully' });
    } catch (error) {
      next(error);
    }
  };
}

export const emailWebhookController = new EmailWebhookController();
