import { Router } from 'express';
import { toolWebhookController } from '../controllers/toolWebhook.controller';

const router = Router();

/**
 * Tool Webhook Routes
 * These endpoints are called by ElevenLabs voice agents during live calls
 * to execute tools/functions
 * 
 * NOTE: These are PUBLIC endpoints (no auth) because ElevenLabs calls them directly
 */

// Calendar Booking Tool
router.post('/calendar-booking', toolWebhookController.handleCalendarBooking.bind(toolWebhookController));

export default router;
