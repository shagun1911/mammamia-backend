import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { batchCallingService } from '../services/batchCalling.service';
import mongoose from 'mongoose';

export class BatchCallingController {
  /**
   * Submit batch calling job
   * POST /api/v1/batch-calling/submit
   */
  async submitBatchCall(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        agent_id,
        call_name,
        recipients,
        retry_count,
        sender_email: requestSenderEmail,
        phone_number_id,
        ecommerce_credentials
      } = req.body;

      // Get sender email from request, or automatically fetch from connected Gmail
      let sender_email = requestSenderEmail;
      
      if (!sender_email) {
        console.log('[Batch Calling Controller] No sender_email provided, fetching from connected Gmail...');
        const organizationId = req.user?.organizationId || req.user?._id;
        
        if (organizationId) {
          try {
            // Try GoogleIntegration first (for Gmail OAuth)
            const GoogleIntegration = (await import('../models/GoogleIntegration')).default;
            const googleIntegration = await GoogleIntegration.findOne({
              organizationId: organizationId instanceof mongoose.Types.ObjectId 
                ? organizationId 
                : new mongoose.Types.ObjectId(organizationId.toString()),
              'services.gmail': true,
              status: 'active'
            }).lean();

            if (googleIntegration?.googleProfile?.email) {
              sender_email = googleIntegration.googleProfile.email;
              console.log('[Batch Calling Controller] ✅ Found Gmail email from GoogleIntegration:', sender_email);
            } else {
              // Fallback: Try SocialIntegration (for Gmail via Dialog360 or other)
              const SocialIntegration = (await import('../models/SocialIntegration')).default;
              const socialIntegration = await SocialIntegration.findOne({
                organizationId: organizationId instanceof mongoose.Types.ObjectId 
                  ? organizationId 
                  : new mongoose.Types.ObjectId(organizationId.toString()),
                platform: 'gmail',
                status: 'connected'
              }).lean();

              if (socialIntegration) {
                // Check credentials.email or metadata.email
                sender_email = socialIntegration.credentials?.email || socialIntegration.metadata?.email;
                if (sender_email) {
                  console.log('[Batch Calling Controller] ✅ Found Gmail email from SocialIntegration:', sender_email);
                }
              }
            }

            if (!sender_email) {
              console.warn('[Batch Calling Controller] ⚠️ No Gmail email found in connected integrations');
            }
          } catch (emailError: any) {
            console.warn('[Batch Calling Controller] ⚠️ Error fetching Gmail email:', emailError.message);
            // Continue without sender_email - it's optional
          }
        }
      }

      console.log('[Batch Calling Controller] ===== SUBMIT BATCH CALL REQUEST =====');
      console.log('[Batch Calling Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[Batch Calling Controller] Request body:', {
        agent_id,
        call_name,
        recipients_count: recipients?.length || 0,
        retry_count,
        sender_email: sender_email || 'not provided',
        has_ecommerce: !!ecommerce_credentials
      });

      // Validate required fields
      if (!agent_id || !call_name || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(422).json({
          detail: [{
            loc: ["body"],
            msg: "agent_id, call_name, and recipients (non-empty array) are required",
            type: "value_error"
          }]
        });
      }

      // Validate phone_number_id is provided
      if (!phone_number_id) {
        return res.status(422).json({
          detail: [{
            loc: ["body", "phone_number_id"],
            msg: "phone_number_id is required",
            type: "value_error"
          }]
        });
      }

      // Get phone number from database and resolve to ElevenLabs phone_number_id
      const PhoneNumber = (await import('../models/PhoneNumber')).default;
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const phoneNumber = await PhoneNumber.findOne({
        phone_number_id,
        organizationId: organizationId instanceof mongoose.Types.ObjectId 
          ? organizationId 
          : new mongoose.Types.ObjectId(organizationId.toString())
      }).lean();

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: "Phone number not found",
          detail: `Phone number with ID ${phone_number_id} not found`
        });
      }

      // Get ElevenLabs phone_number_id (required for batch calling)
      let elevenlabsPhoneNumberId = phoneNumber.elevenlabs_phone_number_id;

      // If not registered, try to register it (for Twilio numbers)
      if (!elevenlabsPhoneNumberId && phoneNumber.provider === 'twilio' && phoneNumber.sid && phoneNumber.token) {
        console.log('[Batch Calling Controller] Phone number not registered, attempting auto-registration...');
        try {
          const { sipTrunkService } = await import('../services/sipTrunk.service');
          const registrationResponse = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
            label: phoneNumber.label,
            phone_number: phoneNumber.phone_number,
            sid: phoneNumber.sid,
            token: phoneNumber.token,
            supports_inbound: phoneNumber.supports_inbound || false,
            supports_outbound: phoneNumber.supports_outbound || false
          });

          // Update phone number with ElevenLabs ID
          await PhoneNumber.updateOne(
            { phone_number_id },
            { $set: { elevenlabs_phone_number_id: registrationResponse.phone_number_id } }
          );

          elevenlabsPhoneNumberId = registrationResponse.phone_number_id;
          console.log('[Batch Calling Controller] ✅ Phone number registered:', elevenlabsPhoneNumberId);
        } catch (registerError: any) {
          console.error('[Batch Calling Controller] ❌ Failed to register phone number:', registerError.message);
          return res.status(registerError.statusCode || 500).json({
            success: false,
            error: {
              code: registerError.code || 'REGISTRATION_ERROR',
              message: `Phone number ${phone_number_id} is not registered with ElevenLabs. Please register it first.`
            }
          });
        }
      }

      if (!elevenlabsPhoneNumberId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PHONE_NUMBER_NOT_REGISTERED',
            message: `Phone number ${phone_number_id} is not registered with ElevenLabs. Please register it first via POST /api/v1/phone-numbers/${phone_number_id}/register`
          }
        });
      }

      // Validate recipients structure
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        if (!recipient.phone_number || !recipient.name) {
          return res.status(422).json({
            detail: [{
              loc: ["body", "recipients", i],
              msg: "phone_number and name are required for each recipient",
              type: "value_error"
            }]
          });
        }
      }

      // Call Python service to submit batch call
      console.log('[Batch Calling Controller] Calling Python service...');
      console.log('[Batch Calling Controller] Using ElevenLabs phone_number_id:', elevenlabsPhoneNumberId);
      const result = await batchCallingService.submitBatchCall({
        agent_id,
        call_name,
        recipients: recipients.map((r: any) => ({
          phone_number: r.phone_number,
          name: r.name,
          ...(r.email && { email: r.email })
        })),
        retry_count: retry_count || 0,
        sender_email,
        phone_number_id: elevenlabsPhoneNumberId, // Use ElevenLabs phone_number_id
        ecommerce_credentials
      });

      console.log('[Batch Calling Controller] ✅ Batch call submitted:');
      console.log(JSON.stringify(result, null, 2));

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const batchCallingController = new BatchCallingController();
