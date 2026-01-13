import nodemailer from 'nodemailer';
import { AppError } from '../middleware/error.middleware';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    contentType?: string;
  }>;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null;
  private isConfigured: boolean;
  private appName: string;
  private appUrl: string;
  private defaultFrom: string;

  constructor() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    this.appName = process.env.APP_NAME || 'KepleroAI';
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Check if SMTP is configured
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      console.warn('[EmailService] SMTP not configured. Email sending will fail.');
      console.warn('[EmailService] Required environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
      this.transporter = null;
      this.isConfigured = false;
      this.defaultFrom = `${this.appName} <noreply@${this.appName.toLowerCase()}.com>`;
      return;
    }

    // Create transporter
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort, 10),
      secure: parseInt(smtpPort, 10) === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      // For development/testing with self-signed certificates
      tls: {
        rejectUnauthorized: false
      }
    });

    this.isConfigured = true;
    this.defaultFrom = `${this.appName} <${smtpUser}>`;
    console.log('[EmailService] SMTP configured successfully');
  }

  async sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isConfigured || !this.transporter) {
      throw new AppError(500, 'EMAIL_NOT_CONFIGURED', 'SMTP is not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS environment variables.');
    }

    try {
      const mailOptions = {
        from: options.from || this.defaultFrom,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        text: options.text,
        html: options.html || options.text,
        replyTo: options.replyTo,
        attachments: options.attachments
      };

      const info = await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error: any) {
      console.error('[EmailService] Failed to send email:', error);
      throw new AppError(500, 'EMAIL_SEND_FAILED', error.message || 'Failed to send email');
    }
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #6366f1; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 5px 5px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ${this.appName}!</h1>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>Welcome to ${this.appName}! We're excited to have you on board.</p>
              <p>Get started by visiting your dashboard:</p>
              <a href="${this.appUrl}" class="button">Go to Dashboard</a>
              <p>If you have any questions, feel free to reach out to our support team.</p>
              <p>Best regards,<br>The ${this.appName} Team</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Welcome to ${this.appName}!`,
      html
    });
  }

  async sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.appUrl}/reset-password?token=${resetToken}`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #6366f1; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 5px 5px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
            .warning { color: #dc2626; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <p>You requested to reset your password for your ${this.appName} account.</p>
              <p>Click the button below to reset your password:</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p class="warning">This link will expire in 1 hour. If you didn't request this, please ignore this email.</p>
              <p>Best regards,<br>The ${this.appName} Team</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Reset Your ${this.appName} Password`,
      html
    });
  }
}

export const emailService = new EmailService();

