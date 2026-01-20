import { google } from 'googleapis';
import GoogleIntegration from '../models/GoogleIntegration';
import { AppError } from '../middleware/error.middleware';

export interface GmailMessage {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
}

export class GoogleGmailService {
  private getOAuth2Client(accessToken: string, refreshToken: string) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/integrations/google/callback'
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    return oauth2Client;
  }

  /**
   * Send email via Gmail API
   */
  async sendEmail(
    userId: string,
    organizationId: string,
    message: GmailMessage
  ): Promise<{ messageId: string; threadId: string }> {
    try {
      // Get integration
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.gmail': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Gmail integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Create email message
      const emailLines: string[] = [];
      emailLines.push(`To: ${message.to}`);
      if (message.cc && message.cc.length > 0) {
        emailLines.push(`Cc: ${message.cc.join(', ')}`);
      }
      if (message.bcc && message.bcc.length > 0) {
        emailLines.push(`Bcc: ${message.bcc.join(', ')}`);
      }
      if (message.replyTo) {
        emailLines.push(`Reply-To: ${message.replyTo}`);
      }
      emailLines.push(`Subject: ${message.subject}`);
      emailLines.push(`Content-Type: ${message.isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`);
      emailLines.push(''); // Empty line before body
      emailLines.push(message.body);

      const email = emailLines.join('\r\n');

      // Encode message in base64url format
      const encodedMessage = Buffer.from(email)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send email
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      });

      // Update last synced
      integration.lastSyncedAt = new Date();
      await integration.save();

      return {
        messageId: response.data.id!,
        threadId: response.data.threadId || ''
      };
    } catch (error: any) {
      console.error('Google Gmail send email error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to send email via Gmail');
    }
  }

  /**
   * Get Gmail integration status
   */
  async getIntegrationStatus(userId: string, organizationId: string): Promise<boolean> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.gmail': true
      });

      return !!integration;
    } catch (error: any) {
      console.error('Google Gmail get status error:', error);
      return false;
    }
  }
}

export const googleGmailService = new GoogleGmailService();
