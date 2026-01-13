import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { google } from 'googleapis';
import GoogleIntegration from '../models/GoogleIntegration';
import { googleSheetsService } from '../services/googleSheets.service';
import { googleDriveService } from '../services/googleDrive.service';
import { googleCalendarService } from '../services/googleCalendar.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

export class GoogleIntegrationController {
  /**
   * Initiate Google OAuth flow
   */
  connect = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { services } = req.body; // ['sheets', 'drive', 'calendar']
      
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/integrations/google/callback'
      );

      // Define scopes based on requested services
      const scopes: string[] = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ];

      if (!services || services.includes('sheets')) {
        scopes.push('https://www.googleapis.com/auth/spreadsheets');
        scopes.push('https://www.googleapis.com/auth/drive.file');
      }

      if (!services || services.includes('drive')) {
        scopes.push('https://www.googleapis.com/auth/drive');
      }

      if (!services || services.includes('calendar')) {
        scopes.push('https://www.googleapis.com/auth/calendar');
        scopes.push('https://www.googleapis.com/auth/calendar.events');
      }

      // Store user info in state
      const state = Buffer.from(JSON.stringify({
        userId: req.user._id,
        organizationId: req.user.organizationId,
        services: services || ['sheets', 'drive', 'calendar']
      })).toString('base64');

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state,
        prompt: 'consent' // Force consent to get refresh token
      });

      res.json(successResponse({ authUrl }, 'Authorization URL generated'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handle OAuth callback
   */
  callback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        throw new AppError(400, 'INVALID_REQUEST', 'Missing authorization code or state');
      }

      // Decode state
      const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      const { userId, organizationId, services } = stateData;

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/integrations/google/callback'
      );

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      // Get user profile
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      // Save or update integration
      const integration = await GoogleIntegration.findOneAndUpdate(
        { userId, organizationId },
        {
          userId,
          organizationId,
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token!,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
          services: {
            sheets: services.includes('sheets'),
            drive: services.includes('drive'),
            calendar: services.includes('calendar')
          },
          googleProfile: {
            email: userInfo.data.email!,
            name: userInfo.data.name,
            picture: userInfo.data.picture
          },
          status: 'active',
          lastSyncedAt: new Date()
        },
        { upsert: true, new: true }
      );

      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/settings/integrations?success=google&services=${services.join(',')}`);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get integration status
   */
  getStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const integration = await GoogleIntegration.findOne({
        userId: req.user._id,
        organizationId: req.user.organizationId
      });

      if (!integration) {
        return res.json(successResponse({ connected: false }));
      }

      res.json(successResponse({
        connected: true,
        services: integration.services,
        googleProfile: integration.googleProfile,
        status: integration.status,
        lastSyncedAt: integration.lastSyncedAt
      }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Disconnect integration
   */
  disconnect = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await GoogleIntegration.deleteOne({
        userId: req.user._id,
        organizationId: req.user.organizationId
      });

      res.json(successResponse(null, 'Google integration disconnected'));
    } catch (error) {
      next(error);
    }
  };

  // === SHEETS ENDPOINTS ===

  exportContacts = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { spreadsheetId } = req.body;
      
      const result = await googleSheetsService.exportContactsToSheet(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        spreadsheetId
      );

      res.json(successResponse(result, 'Contacts exported successfully'));
    } catch (error) {
      next(error);
    }
  };

  importContacts = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { spreadsheetId, range } = req.body;

      const result = await googleSheetsService.importContactsFromSheet(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        spreadsheetId,
        range
      );

      res.json(successResponse(result, 'Contacts imported successfully'));
    } catch (error) {
      next(error);
    }
  };

  listSpreadsheets = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const spreadsheets = await googleSheetsService.listSpreadsheets(
        req.user._id.toString(),
        req.user.organizationId.toString()
      );

      res.json(successResponse({ spreadsheets }));
    } catch (error) {
      next(error);
    }
  };

  // === DRIVE ENDPOINTS ===

  listDriveFiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { folderId, pageSize } = req.query;

      const files = await googleDriveService.listFiles(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        folderId as string,
        pageSize ? Number(pageSize) : undefined
      );

      res.json(successResponse({ files }));
    } catch (error) {
      next(error);
    }
  };

  createDriveFolder = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { folderName, parentFolderId } = req.body;

      const result = await googleDriveService.createFolder(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        folderName,
        parentFolderId
      );

      res.json(successResponse(result, 'Folder created successfully'));
    } catch (error) {
      next(error);
    }
  };

  uploadToDrive = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError(400, 'VALIDATION_ERROR', 'No file provided');
      }

      const { name, folderId } = req.body;

      const result = await googleDriveService.uploadFile(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        req.file.buffer,
        name || req.file.originalname,
        req.file.mimetype,
        folderId
      );

      res.json(successResponse(result, 'File uploaded successfully'));
    } catch (error) {
      next(error);
    }
  };

  downloadFromDrive = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { fileId } = req.params;
      const destinationPath = `/tmp/${fileId}_${Date.now()}`;

      const filePath = await googleDriveService.downloadFile(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        fileId,
        destinationPath
      );

      res.json(successResponse({ filePath }, 'File downloaded successfully'));
    } catch (error) {
      next(error);
    }
  };

  // === CALENDAR ENDPOINTS ===

  listCalendars = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const calendars = await googleCalendarService.listCalendars(
        req.user._id.toString(),
        req.user.organizationId.toString()
      );

      res.json(successResponse({ calendars }));
    } catch (error) {
      next(error);
    }
  };

  listEvents = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { calendarId, timeMin, timeMax, maxResults } = req.query;

      const events = await googleCalendarService.listEvents(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        calendarId as string,
        timeMin ? new Date(timeMin as string) : undefined,
        timeMax ? new Date(timeMax as string) : undefined,
        maxResults ? Number(maxResults) : undefined
      );

      res.json(successResponse({ events }));
    } catch (error) {
      next(error);
    }
  };

  createEvent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { calendarId, summary, description, startTime, endTime, attendees, location } = req.body;

      // Transform the request into Google Calendar event format
      const event = {
        summary: summary || 'Untitled Event',
        description,
        start: {
          dateTime: startTime,
          timeZone: 'UTC'
        },
        end: {
          dateTime: endTime,
          timeZone: 'UTC'
        },
        attendees: attendees || [],
        location
      };

      const result = await googleCalendarService.createEvent(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        event,
        calendarId || 'primary'
      );

      res.json(successResponse(result, 'Event created successfully'));
    } catch (error) {
      next(error);
    }
  };

  updateEvent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { eventId } = req.params;
      const { calendarId, eventUpdates } = req.body;

      const result = await googleCalendarService.updateEvent(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        eventId,
        eventUpdates,
        calendarId
      );

      res.json(successResponse(result, 'Event updated successfully'));
    } catch (error) {
      next(error);
    }
  };

  deleteEvent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { eventId } = req.params;
      const { calendarId } = req.query;

      await googleCalendarService.deleteEvent(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        eventId,
        calendarId as string
      );

      res.json(successResponse(null, 'Event deleted successfully'));
    } catch (error) {
      next(error);
    }
  };

  checkAvailability = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { timeMin, timeMax, calendarIds } = req.body;

      const availability = await googleCalendarService.checkAvailability(
        req.user._id.toString(),
        req.user.organizationId.toString(),
        new Date(timeMin),
        new Date(timeMax),
        calendarIds
      );

      res.json(successResponse({ availability }));
    } catch (error) {
      next(error);
    }
  };
}

export const googleIntegrationController = new GoogleIntegrationController();

