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

            // Priority 2: Default SMTP sender
            if (!sender_email) {
              sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
            }
          } catch (emailError: any) {
            console.warn('[Batch Calling Controller] ⚠️ Error resolving sender email:', emailError.message);
            // Fallback to DEFAULT_SMTP_SENDER_EMAIL on error
            if (!sender_email) {
              sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
            }
          }
        } else {
          // No organizationId, try DEFAULT_SMTP_SENDER_EMAIL
          sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
        }
        
        // Log resolved sender email
        console.log('[Outbound Call] sender_email resolved:', sender_email ?? 'python-fallback');
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

      // Helper to submit batch call (used for initial attempt and retry after re-register)
      const doSubmit = (elevenLabsId: string) =>
        batchCallingService.submitBatchCall({
          agent_id,
          call_name,
          recipients: recipients.map((r: any) => ({
            phone_number: r.phone_number,
            name: r.name,
            ...(r.email && { email: r.email }),
            ...(r.dynamic_variables && { dynamic_variables: r.dynamic_variables })
          })),
          retry_count: retry_count || 0,
          sender_email,
          phone_number_id: elevenLabsId,
          ecommerce_credentials
        });

      // Call Python service to submit batch call
      console.log('[Batch Calling Controller] Calling Python service...');
      console.log('[Batch Calling Controller] Using ElevenLabs phone_number_id:', elevenlabsPhoneNumberId);
      let result: Awaited<ReturnType<typeof doSubmit>>;
      try {
        result = await doSubmit(elevenlabsPhoneNumberId);
      } catch (submitError: any) {
        // If Python API returns 404 "Document not found", the phone number may be stale – try re-registering once
        const is404NotFound =
          submitError?.statusCode === 404 &&
          (submitError?.message?.includes('not found') || submitError?.message?.includes('Document with id'));
        if (!is404NotFound) throw submitError;

        console.log('[Batch Calling Controller] Phone number not found in voice service (404). Attempting re-registration...');
        const { sipTrunkService } = await import('../services/sipTrunk.service');
        let newElevenLabsId: string;

        try {
          if (phoneNumber.provider === 'twilio' && phoneNumber.sid && phoneNumber.token) {
            const reg = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
              label: phoneNumber.label,
              phone_number: phoneNumber.phone_number,
              sid: phoneNumber.sid,
              token: phoneNumber.token,
              supports_inbound: phoneNumber.supports_inbound || false,
              supports_outbound: phoneNumber.supports_outbound || false
            });
            newElevenLabsId = reg.phone_number_id;
          } else if (
            (phoneNumber.provider === 'sip_trunk' || phoneNumber.provider === 'sip') &&
            phoneNumber.outbound_trunk_config
          ) {
            const reg = await sipTrunkService.registerSipPhoneNumberWithElevenLabs({
              label: phoneNumber.label,
              phone_number: phoneNumber.phone_number,
              provider: (phoneNumber.provider as 'sip_trunk' | 'sip') || 'sip_trunk',
              supports_inbound: phoneNumber.supports_inbound || false,
              supports_outbound: phoneNumber.supports_outbound || false,
              inbound_trunk_config: phoneNumber.inbound_trunk_config,
              outbound_trunk_config: phoneNumber.outbound_trunk_config
            });
            newElevenLabsId = reg.phone_number_id;
          } else {
            return res.status(400).json({
              success: false,
              error: {
                code: 'PHONE_NUMBER_NOT_REGISTERED',
                message:
                  'This phone number is not registered with the voice service. Please open Phone Settings (Configuration → Phone), register this number, then try the batch call again.'
              }
            });
          }

          await PhoneNumber.updateOne(
            { phone_number_id, organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString()) },
            { $set: { elevenlabs_phone_number_id: newElevenLabsId } }
          );
          console.log('[Batch Calling Controller] ✅ Re-registered phone number. New ElevenLabs ID:', newElevenLabsId);
          result = await doSubmit(newElevenLabsId);
        } catch (regError: any) {
          console.error('[Batch Calling Controller] Re-registration failed:', regError.message);
          return res.status(regError.statusCode || 500).json({
            success: false,
            error: {
              code: regError.code || 'REGISTRATION_ERROR',
              message:
                regError.message ||
                'Phone number not found in voice service. Please register it in Phone Settings (Configuration → Phone) and try again.'
            }
          });
        }
      }

      console.log('[Batch Calling Controller] ✅ Batch call submitted:');
      console.log(JSON.stringify(result, null, 2));

      // Store batch call response in database
      try {
        const BatchCall = (await import('../models/BatchCall')).default;
        const userId = req.user?._id;
        
        if (userId && organizationId) {
          await BatchCall.create({
            userId: userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId.toString()),
            organizationId: organizationId instanceof mongoose.Types.ObjectId 
              ? organizationId 
              : new mongoose.Types.ObjectId(organizationId.toString()),
            batch_call_id: result.id,
            name: result.name,
            agent_id: result.agent_id,
            status: result.status,
            phone_number_id: result.phone_number_id,
            phone_provider: result.phone_provider,
            created_at_unix: result.created_at_unix,
            scheduled_time_unix: result.scheduled_time_unix,
            timezone: result.timezone || 'UTC', // Default to UTC if not provided by Python API
            total_calls_dispatched: result.total_calls_dispatched,
            total_calls_scheduled: result.total_calls_scheduled,
            total_calls_finished: result.total_calls_finished,
            last_updated_at_unix: result.last_updated_at_unix,
            retry_count: result.retry_count,
            agent_name: result.agent_name,
            call_name: call_name,
            recipients_count: recipients.length,
            sender_email: sender_email || undefined
          });
          
          console.log('[Batch Calling Controller] ✅ Batch call stored in database with ID:', result.id);
        } else {
          console.warn('[Batch Calling Controller] ⚠️ Could not store batch call - userId or organizationId missing');
        }
      } catch (dbError: any) {
        console.error('[Batch Calling Controller] ⚠️ Failed to store batch call in database:', dbError.message);
        // Don't fail the request if database storage fails - the call was already submitted
      }

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get batch job status
   * GET /api/v1/batch-calling/:jobId
   */
  async getBatchJobStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required'
          }
        });
      }

      // Verify the batch call belongs to the user's organization
      const BatchCall = (await import('../models/BatchCall')).default;
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const batchCall = await BatchCall.findOne({
        batch_call_id: jobId,
        organizationId: organizationId instanceof mongoose.Types.ObjectId 
          ? organizationId 
          : new mongoose.Types.ObjectId(organizationId.toString())
      }).lean();

      if (!batchCall) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BATCH_CALL_NOT_FOUND',
            message: 'Batch call not found or does not belong to your organization'
          }
        });
      }

      // Fetch latest status from Python API
      const result = await batchCallingService.getBatchJobStatus(jobId);

      // Update database with latest status
      try {
        await BatchCall.updateOne(
          { batch_call_id: jobId },
          {
            $set: {
              status: result.status,
              total_calls_dispatched: result.total_calls_dispatched,
              total_calls_scheduled: result.total_calls_scheduled,
              total_calls_finished: result.total_calls_finished,
              last_updated_at_unix: result.last_updated_at_unix
            }
          }
        );
      } catch (dbError: any) {
        console.warn('[Batch Calling Controller] ⚠️ Failed to update batch call status in database:', dbError.message);
        // Don't fail the request if database update fails
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel batch job
   * POST /api/v1/batch-calling/:jobId/cancel
   */
  async cancelBatchJob(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required'
          }
        });
      }

      // Verify the batch call belongs to the user's organization
      const BatchCall = (await import('../models/BatchCall')).default;
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const batchCall = await BatchCall.findOne({
        batch_call_id: jobId,
        organizationId: organizationId instanceof mongoose.Types.ObjectId 
          ? organizationId 
          : new mongoose.Types.ObjectId(organizationId.toString())
      }).lean();

      if (!batchCall) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BATCH_CALL_NOT_FOUND',
            message: 'Batch call not found or does not belong to your organization'
          }
        });
      }

      // Cancel the batch job via Python API
      const result = await batchCallingService.cancelBatchJob(jobId);

      // Update database status
      try {
        await BatchCall.updateOne(
          { batch_call_id: jobId },
          {
            $set: {
              status: 'cancelled',
              last_updated_at_unix: Math.floor(Date.now() / 1000)
            }
          }
        );
      } catch (dbError: any) {
        console.warn('[Batch Calling Controller] ⚠️ Failed to update batch call status in database:', dbError.message);
        // Don't fail the request if database update fails
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all batch calls for the user's organization
   * GET /api/v1/batch-calling
   * Syncs status from Python API for each batch call
   */
  async getBatchCalls(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const BatchCall = (await import('../models/BatchCall')).default;
      
      const batchCalls = await BatchCall.find({
        organizationId: organizationId instanceof mongoose.Types.ObjectId 
          ? organizationId 
          : new mongoose.Types.ObjectId(organizationId.toString())
      })
      .sort({ createdAt: -1 })
      .lean();

      // Sync status from Python API for each batch call
      const syncedBatchCalls = await Promise.all(
        batchCalls.map(async (batchCall) => {
          try {
            // Fetch latest status from Python API
            const latestStatus = await batchCallingService.getBatchJobStatus(batchCall.batch_call_id);
            
            // Update database with latest status if it changed
            const statusChanged = 
              batchCall.status !== latestStatus.status ||
              batchCall.total_calls_dispatched !== latestStatus.total_calls_dispatched ||
              batchCall.total_calls_scheduled !== latestStatus.total_calls_scheduled ||
              batchCall.total_calls_finished !== latestStatus.total_calls_finished;
            
            if (statusChanged) {
              await BatchCall.updateOne(
                { batch_call_id: batchCall.batch_call_id },
                {
                  $set: {
                    status: latestStatus.status,
                    total_calls_dispatched: latestStatus.total_calls_dispatched,
                    total_calls_scheduled: latestStatus.total_calls_scheduled,
                    total_calls_finished: latestStatus.total_calls_finished,
                    last_updated_at_unix: latestStatus.last_updated_at_unix
                  }
                }
              );
              
              // Return updated data
              return {
                ...batchCall,
                status: latestStatus.status,
                total_calls_dispatched: latestStatus.total_calls_dispatched,
                total_calls_scheduled: latestStatus.total_calls_scheduled,
                total_calls_finished: latestStatus.total_calls_finished,
                last_updated_at_unix: latestStatus.last_updated_at_unix
              };
            }
            
            return batchCall;
          } catch (error: any) {
            // If Python API call fails, return the database record as-is
            console.warn(`[Batch Calling Controller] ⚠️ Failed to sync status for batch call ${batchCall.batch_call_id}:`, error.message);
            return batchCall;
          }
        })
      );

      res.status(200).json({
        success: true,
        data: syncedBatchCalls
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get batch job calls (individual call results)
   * GET /api/v1/batch-calling/:jobId/calls
   */
  async getBatchJobCalls(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      const { status, cursor, page_size } = req.query;
      
      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required'
          }
        });
      }

      // Verify the batch call belongs to the user's organization
      const BatchCall = (await import('../models/BatchCall')).default;
      const organizationId = req.user?.organizationId || req.user?._id;
      
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const batchCall = await BatchCall.findOne({
        batch_call_id: jobId,
        organizationId: organizationId instanceof mongoose.Types.ObjectId 
          ? organizationId 
          : new mongoose.Types.ObjectId(organizationId.toString())
      }).lean();

      if (!batchCall) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BATCH_CALL_NOT_FOUND',
            message: 'Batch call not found or does not belong to your organization'
          }
        });
      }

      // Fetch calls from Python API
      const result = await batchCallingService.getBatchJobCalls(jobId, {
        status: status as string | undefined,
        cursor: cursor as string | undefined,
        page_size: page_size ? parseInt(page_size as string, 10) : undefined
      });

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

export const batchCallingController = new BatchCallingController();
