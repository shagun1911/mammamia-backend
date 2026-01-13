import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import GoogleIntegration from '../models/GoogleIntegration';
import { AppError } from '../middleware/error.middleware';

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: {
    dateTime: string; // ISO 8601 format
    timeZone?: string;
  };
  end: {
    dateTime: string; // ISO 8601 format
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  location?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
}

export class GoogleCalendarService {
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
   * Create calendar event
   */
  async createEvent(
    userId: string,
    organizationId: string,
    event: CalendarEvent,
    calendarId: string = 'primary'
  ): Promise<{ eventId: string; htmlLink: string; hangoutLink?: string }> {
    try {
      // Get integration
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: 1 // Enable Google Meet
      });

      // Update last synced
      integration.lastSyncedAt = new Date();
      await integration.save();

      return {
        eventId: response.data.id!,
        htmlLink: response.data.htmlLink!,
        hangoutLink: response.data.hangoutLink || undefined
      };
    } catch (error: any) {
      console.error('Google Calendar create event error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to create calendar event');
    }
  }

  /**
   * List calendar events
   */
  async listEvents(
    userId: string,
    organizationId: string,
    calendarId: string = 'primary',
    timeMin?: Date,
    timeMax?: Date,
    maxResults: number = 50
  ): Promise<any[]> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin ? timeMin.toISOString() : new Date().toISOString(),
        timeMax: timeMax?.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items || [];
    } catch (error: any) {
      console.error('Google Calendar list events error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to list calendar events');
    }
  }

  /**
   * Update calendar event
   */
  async updateEvent(
    userId: string,
    organizationId: string,
    eventId: string,
    eventUpdates: Partial<CalendarEvent>,
    calendarId: string = 'primary'
  ): Promise<{ eventId: string; htmlLink: string }> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: eventUpdates
      });

      return {
        eventId: response.data.id!,
        htmlLink: response.data.htmlLink!
      };
    } catch (error: any) {
      console.error('Google Calendar update event error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to update calendar event');
    }
  }

  /**
   * Delete calendar event
   */
  async deleteEvent(
    userId: string,
    organizationId: string,
    eventId: string,
    calendarId: string = 'primary'
  ): Promise<void> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({
        calendarId,
        eventId
      });
    } catch (error: any) {
      console.error('Google Calendar delete event error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to delete calendar event');
    }
  }

  /**
   * List user's calendars
   */
  async listCalendars(
    userId: string,
    organizationId: string
  ): Promise<any[]> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.calendarList.list();

      return response.data.items || [];
    } catch (error: any) {
      console.error('Google Calendar list calendars error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to list calendars');
    }
  }

  /**
   * Check availability (free/busy)
   */
  async checkAvailability(
    userId: string,
    organizationId: string,
    timeMin: Date,
    timeMax: Date,
    calendarIds: string[] = ['primary']
  ): Promise<any> {
    try {
      const integration = await GoogleIntegration.findOne({
        userId,
        organizationId,
        status: 'active',
        'services.calendar': true
      });

      if (!integration) {
        throw new AppError(404, 'NOT_FOUND', 'Google Calendar integration not found');
      }

      const oauth2Client = this.getOAuth2Client(integration.accessToken, integration.refreshToken);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: calendarIds.map(id => ({ id }))
        }
      });

      return response.data.calendars;
    } catch (error: any) {
      console.error('Google Calendar availability check error:', error);
      throw new AppError(500, 'INTEGRATION_ERROR', error.message || 'Failed to check availability');
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();

