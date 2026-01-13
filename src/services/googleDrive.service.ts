import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import GoogleIntegration from '../models/GoogleIntegration';
import { AppError } from '../middleware/error.middleware';
import fs from 'fs';
import path from 'path';

export class GoogleDriveService {
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
   * Upload file to Google Drive
   */
  async uploadFile(
    userId: string,
    organizationId: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    folderId?: string
  ): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
    try {
      // Get integration
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.drive': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Drive integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      const fileMetadata: any = {
        name: fileName
      };

      if (folderId) {
        fileMetadata.parents = [folderId];
      }

      // Create stream from buffer
      const { Readable } = require('stream');
      const bufferStream = new Readable();
      bufferStream.push(fileBuffer);
      bufferStream.push(null);

      const media = {
        mimeType,
        body: bufferStream
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink'
      });

      // Update last synced
      integration.lastSyncedAt = new Date();
      await integration.save();

      return {
        fileId: response.data.id!,
        webViewLink: response.data.webViewLink!,
        webContentLink: response.data.webContentLink!
      };
    } catch (error: any) {
      console.error('Google Drive upload error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to upload to Google Drive');
    }
  }

  /**
   * List files from Google Drive
   */
  async listFiles(
    userId: string,
    organizationId: string,
    folderId?: string,
    pageSize: number = 50
  ): Promise<any[]> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.drive': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Drive integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      let query = "trashed=false";
      if (folderId) {
        query += ` and '${folderId}' in parents`;
      }

      const response = await drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType, createdTime, modifiedTime, size, webViewLink, iconLink, thumbnailLink)',
        orderBy: 'modifiedTime desc',
        pageSize
      });

      return response.data.files || [];
    } catch (error: any) {
      console.error('Google Drive list error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to list Drive files');
    }
  }

  /**
   * Download file from Google Drive
   */
  async downloadFile(
    userId: string,
    organizationId: string,
    fileId: string,
    destinationPath: string
  ): Promise<string> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.drive': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Drive integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      const dest = fs.createWriteStream(destinationPath);

      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      return new Promise((resolve, reject) => {
        response.data
          .on('end', () => {
            resolve(destinationPath);
          })
          .on('error', (err) => {
            reject(err);
          })
          .pipe(dest);
      });
    } catch (error: any) {
      console.error('Google Drive download error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to download from Google Drive');
    }
  }

  /**
   * Create folder in Google Drive
   */
  async createFolder(
    userId: string,
    organizationId: string,
    folderName: string,
    parentFolderId?: string
  ): Promise<{ folderId: string; webViewLink: string }> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.drive': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Drive integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      const fileMetadata: any = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, webViewLink'
      });

      return {
        folderId: response.data.id!,
        webViewLink: response.data.webViewLink!
      };
    } catch (error: any) {
      console.error('Google Drive create folder error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to create folder');
    }
  }

  /**
   * Delete file from Google Drive
   */
  async deleteFile(
    userId: string,
    organizationId: string,
    fileId: string
  ): Promise<void> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.drive': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Drive integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      await drive.files.delete({ fileId });
    } catch (error: any) {
      console.error('Google Drive delete error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to delete file');
    }
  }
}

export const googleDriveService = new GoogleDriveService();

