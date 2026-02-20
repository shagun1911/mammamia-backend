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
        phone_number_id
      } = req.body;

      console.log('[Batch Calling Controller] ===== SUBMIT BATCH CALL REQUEST =====');
      console.log('[Batch Calling Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[Batch Calling Controller] Request body:', {
        agent_id,
        call_name,
        recipients_count: recipients?.length || 0,
        phone_number_id
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
      if (!req.user?._id) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "User ID not found"
        });
      }
      const userId = req.user._id;
      const { profileService } = await import('../services/profile.service');
      const organizationIdStr = await profileService.ensureOrganizationForUser(userId.toString());
      const organizationId = new mongoose.Types.ObjectId(organizationIdStr);

      // Find by phone_number_id and (organizationId or userId) so we match legacy records stored with userId
      const phoneNumber = await PhoneNumber.findOne({
        phone_number_id,
        $or: [
          { organizationId },
          { userId }
        ]
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

      // Helper to prepare recipients payload
      const prepareRecipients = (recipientsList: any[]) => {
        return recipientsList.map((r: any) => {
          const recipient: any = {
            phone_number: r.phone_number,
            name: r.name
          };

          // Extract email from dynamic_variables if present and add it as a top-level field
          const email = r.email || r.dynamic_variables?.email || r.dynamic_variables?.customer_email || r.dynamic_variables?.['contact.email'];
          if (email) {
            recipient.email = email;
          }

          // Include dynamic_variables ONLY if provided (preserve exactly as received)
          if (r.dynamic_variables !== undefined && r.dynamic_variables !== null) {
            recipient.dynamic_variables = r.dynamic_variables;
          }
          return recipient;
        });
      };

      // Helper to submit batch call (used for initial attempt and retry after re-register)
      const doSubmit = (elevenLabsId: string) => {
        // Build payload with ONLY the required fields - no transformations, no enrichment
        const payload = {
          agent_id,
          call_name,
          phone_number_id: elevenLabsId,
          recipients: prepareRecipients(recipients)
        };

        // Log summary only (no PII – do not log full recipient list)
        console.log('[Batch Calling Controller] Submitting batch:', {
          recipients_count: payload.recipients.length,
          agent_id: payload.agent_id,
          phone_number_id: payload.phone_number_id
        });

        return batchCallingService.submitBatchCall(payload);
      };

      // Check if queue is available - use it for background processing
      const { enqueueBatchCall, isBatchCallQueueAvailable } = await import('../queues/batchCall.queue');
      const queueAvailable = isBatchCallQueueAvailable();

      if (queueAvailable) {
        console.log('[Batch Calling Controller] 🚀 Queue available - enqueueing batch call job for background processing');
        console.log('[Batch Calling Controller] Recipients count:', recipients.length);
        
        // Prepare recipients for queue
        const preparedRecipients = prepareRecipients(recipients);
        
        // Enqueue job
        const job = await enqueueBatchCall({
          agent_id,
          call_name,
          recipients: preparedRecipients,
          phone_number_id: elevenlabsPhoneNumberId,
          userId,
          organizationId
        });

        if (job) {
          console.log('[Batch Calling Controller] ✅ Batch call job enqueued:', job.id);
          
          // Return immediately with job info (batch will be processed in background)
          return res.status(202).json({
            success: true,
            message: 'Batch call job enqueued for processing',
            job_id: job.id.toString(),
            recipients_count: recipients.length,
            status: 'queued'
          });
        } else {
          console.warn('[Batch Calling Controller] ⚠️  Failed to enqueue job, falling back to synchronous processing');
          // Fall through to synchronous processing
        }
      } else {
        console.log('[Batch Calling Controller] ℹ️  Queue not available - using synchronous processing');
      }

      // Synchronous processing (fallback or when queue unavailable)
      console.log('[Batch Calling Controller] Calling Python service synchronously...');
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
            { phone_number_id, $or: [{ organizationId }, { userId }] },
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

      console.log('[Batch Calling Controller] ✅ Batch call submitted:', { id: result?.id, status: result?.status });

      // Store batch call response in database
      try {
        const BatchCall = (await import('../models/BatchCall')).default;
        const userId = req.user?._id;

        if (userId && organizationId) {
          await BatchCall.create({
            userId: userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId.toString()),
            organizationId,
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
            conversations_synced: false // Track if conversations have been created
          });

          console.log('[Batch Calling Controller] ✅ Batch call stored in database with ID:', result.id);
          
          // ============================================================
          // ENQUEUE POLL JOB FOR AUTOMATIC BATCH COMPLETION DETECTION
          // ============================================================
          // This starts the background polling loop that will:
          // 1. Poll Python API every 2s to check batch status
          // 2. When completed, enqueue sync job to create conversations
          // 3. Sync job triggers batch_call_completed automations
          // No user action needed - automations fire automatically!
          try {
            const { enqueueBatchPoll } = await import('../queues/batchCallSync.queue');
            const enqueued = await enqueueBatchPoll(result.id, organizationIdStr);
            
            if (enqueued) {
              console.log('[Batch Calling Controller] 🚀 Background polling started for batch:', result.id);
              console.log('[Batch Calling Controller] ⚡ Automations will trigger automatically when batch completes');
            } else {
              console.log('[Batch Calling Controller] ℹ️  Queue not available - batch will rely on BatchCallMonitor fallback');
            }
          } catch (queueError: any) {
            // Don't fail the request if queue enqueue fails
            console.warn('[Batch Calling Controller] ⚠️  Failed to enqueue batch poll:', queueError.message);
            console.warn('[Batch Calling Controller] ℹ️  Batch will rely on BatchCallMonitor fallback or user-triggered sync');
          }
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
      let updatedBatchCall: any = null;
      try {
        updatedBatchCall = await BatchCall.findOneAndUpdate(
          { batch_call_id: jobId },
          {
            $set: {
              status: result.status,
              total_calls_dispatched: result.total_calls_dispatched,
              total_calls_scheduled: result.total_calls_scheduled,
              total_calls_finished: result.total_calls_finished,
              last_updated_at_unix: result.last_updated_at_unix
            }
          },
          { new: true }
        );
      } catch (dbError: any) {
        console.warn('[Batch Calling Controller] ⚠️ Failed to update batch call status in database:', dbError.message);
        // Don't fail the request if database update fails
      }

      // If batch call is completed and conversations haven't been synced, fetch results and create conversations
      if (result.status === 'completed' && updatedBatchCall && !updatedBatchCall.conversations_synced) {
        console.log('[Batch Calling Controller] 🚀 Batch call completed! Fetching results and creating conversations...');

        // Process results asynchronously (don't block the response)
        batchCallingService.syncBatchCallConversations(jobId, organizationId.toString()).catch((error: any) => {
          console.error('[Batch Calling Controller] ❌ Failed to sync batch call conversations:', error.message);
          // Don't throw - we don't want to fail the status request
        });
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
      const includeCancelled = req.query.includeCancelled === 'true';

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const BatchCall = (await import('../models/BatchCall')).default;
      const query: any = {
        organizationId: organizationId instanceof mongoose.Types.ObjectId
          ? organizationId
          : new mongoose.Types.ObjectId(organizationId.toString())
      };
      if (!includeCancelled) {
        query.status = { $ne: 'cancelled' };
      }

      const batchCalls = await BatchCall.find(query)
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

  /**
   * Manually sync batch call conversations
   * POST /api/v1/batch-calling/:jobId/sync
   */
  async syncBatchCallConversations(req: AuthRequest, res: Response, next: NextFunction) {
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

      console.log(`[Batch Calling Controller] 🔄 Manually syncing conversations for batch call: ${jobId}`);

      // Sync conversations
      await batchCallingService.syncBatchCallConversations(jobId, organizationId.toString());

      res.status(200).json({
        success: true,
        message: 'Batch call conversations synced successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get batch job results with transcripts
   * GET /api/v1/batch-calling/:jobId/results
   */
  async getBatchJobResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      const { include_transcript } = req.query;

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

      // Parse include_transcript query parameter (default: true)
      let includeTranscript = true; // Default to true
      if (include_transcript !== undefined) {
        if (typeof include_transcript === 'string') {
          includeTranscript = include_transcript.toLowerCase() === 'true';
        } else if (Array.isArray(include_transcript)) {
          includeTranscript = include_transcript[0]?.toString().toLowerCase() === 'true';
        } else {
          includeTranscript = String(include_transcript).toLowerCase() === 'true';
        }
      }

      // Fetch results with transcripts from Python API
      const result = await batchCallingService.getBatchJobResults(jobId, includeTranscript);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const batchCallingController = new BatchCallingController();
