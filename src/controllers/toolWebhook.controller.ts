import { Request, Response } from 'express';
import { googleCalendarService } from '../services/googleCalendar.service';
import { googleSheetsService } from '../services/googleSheets.service';
import GoogleIntegration from '../models/GoogleIntegration';
import Conversation from '../models/Conversation';
import Customer from '../models/Customer';
import mongoose from 'mongoose';

/**
 * Tool Webhook Controller
 * Handles tool execution requests from ElevenLabs voice agents during calls
 */
export class ToolWebhookController {
  /**
   * Handle calendar booking tool execution
   * POST /api/v1/tools/webhook/calendar-booking
   * 
   * Expected payload from ElevenLabs:
   * {
   *   "customer_name": "John Doe",
   *   "customer_email": "john@example.com",
   *   "customer_phone": "+1234567890",
   *   "appointment_date": "2026-02-07",
   *   "appointment_time": "15:00",
   *   "conversation_id": "conv_xxx",
   *   "organization_id": "org_xxx"
   * }
   */
  async handleCalendarBooking(req: Request, res: Response) {
    try {
      console.log('[Tool Webhook] ===== CALENDAR BOOKING TOOL CALLED =====');
      console.log('[Tool Webhook] Request body:', JSON.stringify(req.body, null, 2));

      const {
        customer_name,
        customer_email,
        customer_phone,
        appointment_date,
        appointment_time,
        conversation_id,
        organization_id,
        phone_number_id, // ElevenLabs phone number ID
        to_number, // The number being called
        from_number // The number calling from
      } = req.body;

      // Validate required fields
      if (!customer_name || !appointment_date || !appointment_time) {
        console.error('[Tool Webhook] Missing required fields');
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: customer_name, appointment_date, appointment_time are required'
        });
      }

      // Find organization ID from multiple sources
      let orgObjectId: mongoose.Types.ObjectId | null = null;

      // Try from explicit organization_id first
      if (organization_id && mongoose.isValidObjectId(organization_id)) {
        orgObjectId = new mongoose.Types.ObjectId(organization_id);
      }
      // Try from conversation_id
      else if (conversation_id && mongoose.isValidObjectId(conversation_id)) {
        const conv = await Conversation.findById(conversation_id).select('organizationId').lean();
        if (conv?.organizationId) {
          orgObjectId = new mongoose.Types.ObjectId(conv.organizationId.toString());
          console.log('[Tool Webhook] Found organization from conversation:', orgObjectId);
        }
      }
      // Try from phone_number_id (ElevenLabs ID)
      else if (phone_number_id) {
        const PhoneNumber = (await import('../models/PhoneNumber')).default;
        const phone = await PhoneNumber.findOne({
          $or: [
            { elevenlabs_phone_number_id: phone_number_id },
            { phone_number_id: phone_number_id }
          ]
        }).select('organizationId').lean();
        if (phone?.organizationId) {
          orgObjectId = new mongoose.Types.ObjectId(phone.organizationId.toString());
          console.log('[Tool Webhook] Found organization from phone number:', orgObjectId);
        }
      }
      // Try from customer phone number
      else if (customer_phone) {
        const customer = await Customer.findOne({ phone: customer_phone }).select('organizationId').lean();
        if (customer?.organizationId) {
          orgObjectId = new mongoose.Types.ObjectId(customer.organizationId.toString());
          console.log('[Tool Webhook] Found organization from customer:', orgObjectId);
        }
      }

      // If still no organization, try to find ANY active Google Calendar integration (fallback for single-tenant setups)
      if (!orgObjectId) {
        console.warn('[Tool Webhook] No organization found from request, trying fallback...');
        const anyIntegration = await GoogleIntegration.findOne({
          status: 'active',
          'services.calendar': true
        }).select('organizationId').lean();
        if (anyIntegration?.organizationId) {
          orgObjectId = new mongoose.Types.ObjectId(anyIntegration.organizationId.toString());
          console.log('[Tool Webhook] Using fallback organization:', orgObjectId);
        }
      }

      if (!orgObjectId) {
        console.error('[Tool Webhook] Could not determine organization');
        return res.status(400).json({
          success: false,
          error: 'Unable to determine organization. Please ensure Google Calendar is connected.'
        });
      }

      const googleIntegration = await GoogleIntegration.findOne({
        organizationId: orgObjectId,
        status: 'active',
        'services.calendar': true
      });

      if (!googleIntegration) {
        console.error('[Tool Webhook] Google Calendar integration not found');
        return res.status(400).json({
          success: false,
          error: 'Google Calendar integration not connected. Please connect Google Calendar in Settings.'
        });
      }

      // Parse date and time
      const appointmentDateTime = new Date(`${appointment_date}T${appointment_time}:00Z`);
      if (isNaN(appointmentDateTime.getTime())) {
        console.error('[Tool Webhook] Invalid date/time format');
        return res.status(400).json({
          success: false,
          error: 'Invalid date or time format'
        });
      }

      // Check calendar availability (1-hour slot)
      const endTime = new Date(appointmentDateTime.getTime() + 60 * 60 * 1000);
      
      console.log(`[Tool Webhook] Checking calendar availability: ${appointmentDateTime.toISOString()} - ${endTime.toISOString()}`);

      try {
        const availability = await googleCalendarService.checkAvailability(
          googleIntegration.userId.toString(),
          orgObjectId.toString(),
          appointmentDateTime,
          endTime,
          ['primary']
        );

        console.log('[Tool Webhook] Availability check result:', availability);

        // If slot is not available, return error
        if (!availability.isAvailable || availability.conflicts.length > 0) {
          console.warn('[Tool Webhook] Time slot not available');
          return res.status(200).json({
            success: false,
            error: 'This time slot is not available. Please choose another time.',
            slot_available: false
          });
        }
      } catch (availError: any) {
        console.error('[Tool Webhook] Availability check failed:', availError.message);
        return res.status(200).json({
          success: false,
          error: 'Unable to check calendar availability at this moment.'
        });
      }

      // Create calendar event
      try {
        const calendarEvent = {
          summary: `Appointment - ${customer_name}`,
          description: `Booked via AI voice call\n\nCustomer: ${customer_name}\nEmail: ${customer_email || 'N/A'}\nPhone: ${customer_phone || 'N/A'}\nConversation ID: ${conversation_id || 'N/A'}`,
          start: {
            dateTime: appointmentDateTime.toISOString(),
            timeZone: 'UTC'
          },
          end: {
            dateTime: endTime.toISOString(),
            timeZone: 'UTC'
          },
          location: 'Phone Call',
          attendees: customer_email ? [{ email: customer_email }] : []
        };

        console.log('[Tool Webhook] Creating calendar event:', calendarEvent);

        const event = await googleCalendarService.createEvent(
          googleIntegration.userId.toString(),
          orgObjectId.toString(),
          calendarEvent,
          'primary'
        );

        console.log('[Tool Webhook] ✅ Calendar event created:', event.eventId);

        // Log to Google Sheets (optional - non-blocking)
        try {
          // Get user's default spreadsheet from Google Sheets integration
          const sheetsIntegration = await GoogleIntegration.findOne({
            organizationId: orgObjectId,
            status: 'active',
            'services.sheets': true
          });

          if (sheetsIntegration) {
            // Try to append to default sheet (if spreadsheetId is configured)
            // This is optional - we'll just log for now
            console.log('[Tool Webhook] Google Sheets integration found - could log appointment here');
          }
        } catch (sheetError: any) {
          console.warn('[Tool Webhook] Sheet logging failed (non-critical):', sheetError.message);
        }

        // Update conversation metadata with appointment info
        if (conversation_id) {
          try {
            await Conversation.findOneAndUpdate(
              { _id: conversation_id },
              {
                $set: {
                  'metadata.appointment_booked': true,
                  'metadata.appointment_date': appointment_date,
                  'metadata.appointment_time': appointment_time,
                  'metadata.calendar_event_id': event.eventId
                }
              }
            );
            console.log('[Tool Webhook] ✅ Updated conversation with appointment info');
          } catch (convError: any) {
            console.warn('[Tool Webhook] Failed to update conversation (non-critical):', convError.message);
          }
        }

        // Return success response to ElevenLabs agent
        return res.status(200).json({
          success: true,
          message: `Appointment booked successfully for ${customer_name} on ${appointment_date} at ${appointment_time}.`,
          slot_available: true,
          event_id: event.eventId,
          confirmation: `Your appointment has been confirmed for ${appointment_date} at ${appointment_time}. A confirmation has been sent to ${customer_email || 'your contact'}.`
        });

      } catch (createError: any) {
        console.error('[Tool Webhook] Calendar event creation failed:', createError.message);
        return res.status(200).json({
          success: false,
          error: 'Unable to book the appointment at this moment. Please try again.'
        });
      }

    } catch (error: any) {
      console.error('[Tool Webhook] Calendar booking error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while processing booking'
      });
    }
  }
}

export const toolWebhookController = new ToolWebhookController();
