import { google } from 'googleapis';
import GoogleIntegration from '../models/GoogleIntegration';
import Customer from '../models/Customer'; // Using Customer instead of Contact
import { AppError } from '../middleware/error.middleware';

export class GoogleSheetsService {
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
   * Export contacts to Google Sheets
   */
  async exportContactsToSheet(
    userId: string,
    organizationId: string,
    spreadsheetId?: string
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    try {
      // Get integration
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.sheets': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Sheets integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

      // Get contacts
      const contacts = await Customer.find({ organizationId }).lean();

      // Prepare data
      const headers = ['Name', 'Email', 'Phone', 'Status', 'Tags', 'Created At'];
      const rows = contacts.map((contact: any) => [
        contact.name || '',
        contact.email || '',
        contact.phone || '',
        contact.status || '',
        (contact.tags || []).join(', '),
        contact.createdAt?.toISOString() || ''
      ]);

      const values = [headers, ...rows];

      let finalSpreadsheetId = spreadsheetId;
      let spreadsheetUrl = '';

      if (!spreadsheetId) {
        // Create new spreadsheet
        const createResponse = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: `Contacts Export - ${new Date().toISOString().split('T')[0]}`
            },
            sheets: [
              {
                properties: {
                  title: 'Contacts'
                }
              }
            ]
          }
        });

        finalSpreadsheetId = createResponse.data.spreadsheetId!;
        spreadsheetUrl = createResponse.data.spreadsheetUrl!;
      }

      // Write data to sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: finalSpreadsheetId!,
        range: 'Contacts!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values
        }
      });

      if (!spreadsheetUrl) {
        spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${finalSpreadsheetId}`;
      }

      // Update last synced
      integration.lastSyncedAt = new Date();
      await integration.save();

      return {
        spreadsheetId: finalSpreadsheetId!,
        spreadsheetUrl
      };
    } catch (error: any) {
      console.error('Google Sheets export error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to export to Google Sheets');
    }
  }

  /**
   * Import contacts from Google Sheets
   */
  async importContactsFromSheet(
    userId: string,
    organizationId: string,
    spreadsheetId: string,
    range: string = 'A2:F'
  ): Promise<{ imported: number; skipped: number }> {
    try {
      // Get integration
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.sheets': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Sheets integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

      // Read data from sheet
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
      });

      const rows = response.data.values || [];
      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        const [name, email, phone, status, tags] = row;

        if (!email) {
          skipped++;
          continue;
        }

        // Check if contact exists
        const existingContact = await Customer.findOne({ email, organizationId });

        if (existingContact) {
          skipped++;
          continue;
        }

        // Create contact
        await Customer.create({
          organizationId,
          name: name || '',
          email,
          phone: phone || '',
          status: status || 'active',
          tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
          source: 'google_sheets'
        });

        imported++;
      }

      // Update last synced
      integration.lastSyncedAt = new Date();
      await integration.save();

      return { imported, skipped };
    } catch (error: any) {
      console.error('Google Sheets import error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to import from Google Sheets');
    }
  }

  /**
   * List available spreadsheets
   */
  async listSpreadsheets(userId: string, organizationId: string): Promise<any[]> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.sheets': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Sheets integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet'",
        fields: 'files(id, name, createdTime, modifiedTime, webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: 50
      });

      return response.data.files || [];
    } catch (error: any) {
      console.error('List spreadsheets error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to list spreadsheets');
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();

