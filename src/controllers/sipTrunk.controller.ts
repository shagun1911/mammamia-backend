import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { sipTrunkService } from '../services/sipTrunk.service';
import { phoneSettingsService } from '../services/phoneSettings.service';
import { successResponse } from '../utils/response.util';
import mongoose from 'mongoose';
import PhoneNumber from '../models/PhoneNumber';

export class SipTrunkController {
  /**
   * Setup SIP trunk with Twilio
   * POST /api/v1/phone-settings/setup-sip-trunk
   */
  async setupSipTrunk(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { label, phone_number, twilio_sid, twilio_auth_token } = req.body;

      console.log('[SIP Trunk Controller] ===== SETUP REQUEST RECEIVED =====');
      console.log('[SIP Trunk Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[SIP Trunk Controller] Full URL:', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
      console.log('[SIP Trunk Controller] User ID:', userId);
      console.log('[SIP Trunk Controller] Request body:', {
        label,
        phone_number,
        twilio_sid,
        twilio_auth_token: '***hidden***'
      });

      // Validate required fields
      if (!label || !phone_number || !twilio_sid || !twilio_auth_token) {
        console.error('[SIP Trunk Controller] Missing required fields');
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: label, phone_number, twilio_sid, twilio_auth_token'
          }
        });
      }

      // Call Python service to setup SIP trunk
      console.log('[SIP Trunk Controller] Calling Python service...');
      const result = await sipTrunkService.setupSipTrunk({
        label,
        phone_number,
        twilio_sid,
        twilio_auth_token
      });

      console.log('[SIP Trunk Controller] ✅ Python service response:');
      console.log(JSON.stringify(result, null, 2));

      // Save all trunk details to user's phone settings
      console.log('[SIP Trunk Controller] Saving to database...');
      const updatedSettings = await phoneSettingsService.update(userId, {
        livekitSipTrunkId: result.livekit_trunk_id,
        twilioTrunkSid: result.twilio_trunk_sid,
        terminationUri: result.termination_uri,
        originationUri: result.origination_uri,
        twilioPhoneNumber: phone_number
      });

      console.log('[SIP Trunk Controller] ✅ Settings saved:', {
        livekitSipTrunkId: updatedSettings.livekitSipTrunkId,
        twilioTrunkSid: updatedSettings.twilioTrunkSid,
        terminationUri: updatedSettings.terminationUri,
        originationUri: updatedSettings.originationUri,
        twilioPhoneNumber: updatedSettings.twilioPhoneNumber
      });

      console.log('[SIP Trunk Controller] Sending response to frontend...');
      res.json(successResponse(result, 'SIP trunk setup successful'));
    } catch (error) {
      next(error);
    }
  }

  // /**
  //  * Create LiveKit SIP trunk
  //  * POST /api/v1/phone-settings/create-livekit-trunk
  //  */
  // async createLivekitTrunk(req: AuthRequest, res: Response, next: NextFunction) {
  //   try {
  //     const userId = req.user!.id;
  //     const { label, phone_number, sip_address, username, password, transport } = req.body;

  //     // Validate required fields
  //     if (!label || !phone_number || !sip_address) {
  //       return res.status(400).json({
  //         success: false,
  //         error: {
  //           code: 'VALIDATION_ERROR',
  //           message: 'Missing required fields: label, phone_number, sip_address'
  //         }
  //       });
  //     }

  //     // Call Python service to create LiveKit trunk
  //     const result = await sipTrunkService.createLivekitTrunk({
  //       label,
  //       phone_number,
  //       sip_address,
  //       username,
  //       password,
  //       transport: transport || 'udp'
  //     });

  //     // Save trunk details to user's phone settings
  //     await phoneSettingsService.update(userId, {
  //       livekitSipTrunkId: result.livekit_trunk_id,
  //       twilioPhoneNumber: phone_number
  //     });

  //     res.json(successResponse(result, 'LiveKit SIP trunk created successfully'));
  //   } catch (error) {
  //     next(error);
  //   }
  // }

  /**
   * Create Generic SIP trunk
   * POST /api/v1/phone-settings/create-generic-sip-trunk
   */
  async createGenericSipTrunk(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { label, phone_number, sip_address, username, password, provider_name, transport, port } = req.body;

      console.log('[SIP Trunk Controller] ===== CREATE GENERIC SIP TRUNK REQUEST =====');
      console.log('[SIP Trunk Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[SIP Trunk Controller] User ID:', userId);
      console.log('[SIP Trunk Controller] Request body:', {
        label,
        phone_number,
        sip_address,
        username,
        password: '***hidden***',
        provider_name: provider_name || 'generic',
        transport: transport || 'udp',
        port: port || 5060
      });

      // Validate required fields
      if (!label || !phone_number || !sip_address || !username || !password) {
        console.error('[SIP Trunk Controller] Missing required fields');
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: label, phone_number, sip_address, username, password'
          }
        });
      }

      // Call Python service to create Generic SIP trunk
      console.log('[SIP Trunk Controller] Calling Python service...');
      const result = await sipTrunkService.createGenericSipTrunk({
        label,
        phone_number,
        sip_address,
        username,
        password,
        provider_name: provider_name || 'generic',
        transport: transport || 'udp',
        port: port || 5060
      });

      console.log('[SIP Trunk Controller] ✅ Python service response:');
      console.log(JSON.stringify(result, null, 2));

      // Save trunk details to user's phone settings
      console.log('[SIP Trunk Controller] Saving to database...');
      const updatedSettings = await phoneSettingsService.update(userId, {
        livekitSipTrunkId: result.livekit_trunk_id,
        twilioPhoneNumber: phone_number,
        sipAddress: sip_address,
        sipUsername: username,
        providerName: result.provider_name,
        transport: result.transport
      });

      console.log('[SIP Trunk Controller] ✅ Settings saved:', {
        livekitSipTrunkId: updatedSettings.livekitSipTrunkId,
        twilioPhoneNumber: updatedSettings.twilioPhoneNumber,
        sipAddress: updatedSettings.sipAddress,
        providerName: updatedSettings.providerName
      });

      console.log('[SIP Trunk Controller] Sending response to frontend...');
      res.json(successResponse(result, 'Generic SIP trunk created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create Inbound trunk with dispatch rule
   * POST /api/v1/phone-settings/create-inbound-trunk
   */
  async createInboundTrunk(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { name, phone_numbers, allowed_numbers, krisp_enabled } = req.body;

      console.log('[SIP Trunk Controller] ===== CREATE INBOUND TRUNK REQUEST =====');
      console.log('[SIP Trunk Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[SIP Trunk Controller] User ID:', userId);
      console.log('[SIP Trunk Controller] Request body:', {
        name,
        phone_numbers,
        allowed_numbers: allowed_numbers || [],
        krisp_enabled: krisp_enabled !== undefined ? krisp_enabled : true
      });

      // Validate required fields
      if (!name || !phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
        console.error('[SIP Trunk Controller] Missing or invalid required fields');
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: name, phone_numbers (array with at least one number)'
          }
        });
      }

      // Step 1: Create inbound trunk
      console.log('[SIP Trunk Controller] Step 1: Creating inbound trunk...');
      const trunkResult = await sipTrunkService.createInboundTrunk({
        name,
        phone_numbers,
        allowed_numbers: allowed_numbers || [],
        krisp_enabled: krisp_enabled !== undefined ? krisp_enabled : true
      });

      console.log('[SIP Trunk Controller] ✅ Inbound trunk created:');
      console.log(JSON.stringify(trunkResult, null, 2));

      // Step 2: Create dispatch rule using the trunk_id
      console.log('[SIP Trunk Controller] Step 2: Creating dispatch rule with trunk_id:', trunkResult.trunk_id);
      
      // Generate a unique name for the dispatch rule
      const uniqueName = `dispatch-${Date.now()}`;
      
      const dispatchResult = await sipTrunkService.createDispatchRule({
        sip_trunk_id: trunkResult.trunk_id,
        name: uniqueName,  // Random unique name
        agent_name: 'love-papa'  // Fixed agent name as requested
      });

      console.log('[SIP Trunk Controller] ✅ Dispatch rule created:');
      console.log(JSON.stringify(dispatchResult, null, 2));

      // Combine results
      const combinedResult = {
        trunk: trunkResult,
        dispatch_rule: dispatchResult
      };

      // Save to database
      console.log('[SIP Trunk Controller] Saving to database...');
      const updatedSettings = await phoneSettingsService.update(userId, {
        inboundTrunkId: trunkResult.trunk_id,
        inboundTrunkName: trunkResult.trunk_name,
        inboundPhoneNumbers: phone_numbers,
        inboundDispatchRuleId: dispatchResult.dispatch_rule_id,
        inboundDispatchRuleName: dispatchResult.dispatch_rule_name
      });

      console.log('[SIP Trunk Controller] ✅ Settings saved:', {
        inboundTrunkId: updatedSettings.inboundTrunkId,
        inboundTrunkName: updatedSettings.inboundTrunkName,
        inboundDispatchRuleId: updatedSettings.inboundDispatchRuleId,
        inboundDispatchRuleName: updatedSettings.inboundDispatchRuleName
      });

      console.log('[SIP Trunk Controller] Sending response to frontend...');
      res.json(successResponse(combinedResult, 'Inbound trunk and dispatch rule created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initiate outbound call via SIP trunk
   * POST /api/v1/sip-trunk/outbound-call
   */
  async outboundCall(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        agent_id,
        agent_phone_number_id,
        to_number,
        customer_info,
        sender_email: requestSenderEmail
      } = req.body;

      // Resolve sender email using priority order:
      // 1. Request-provided email
      // 2. Connected Gmail integration
      // 3. Default SMTP sender
      // 4. Python fallback (undefined - let Python handle it)
      let sender_email: string | undefined = requestSenderEmail;
      
      if (!sender_email) {
        const userId = req.user?._id?.toString() || req.user?.id;
        const organizationId = req.user?.organizationId || req.user?._id;
        
        if (organizationId) {
          try {
            // Priority 1: Connected Gmail integration
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
                sender_email = socialIntegration.credentials?.email || socialIntegration.metadata?.email;
              }
            }

            // Priority 2: Default SMTP sender
            if (!sender_email) {
              sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
            }
          } catch (emailError: any) {
            console.warn('[SIP Trunk Controller] ⚠️ Error resolving sender email:', emailError.message);
            // Fallback to DEFAULT_SMTP_SENDER_EMAIL on error
            if (!sender_email) {
              sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
            }
          }
        } else {
          // No organizationId, try DEFAULT_SMTP_SENDER_EMAIL
          sender_email = process.env.DEFAULT_SMTP_SENDER_EMAIL;
        }
      }

      // Log resolved sender email
      console.log('[Outbound Call] sender_email resolved:', sender_email ?? 'python-fallback');

      console.log('[SIP Trunk Controller] ===== OUTBOUND CALL REQUEST =====');
      console.log('[SIP Trunk Controller] Endpoint:', req.method, req.originalUrl);
      console.log('[SIP Trunk Controller] Request body:', {
        agent_id,
        agent_phone_number_id,
        to_number,
        customer_info,
        sender_email: sender_email || 'not provided'
      });

      // Validate required fields
      if (!agent_id || !agent_phone_number_id || !to_number) {
        return res.status(422).json({
          detail: [{
            loc: ["body"],
            msg: "agent_id, agent_phone_number_id, and to_number are required",
            type: "value_error"
          }]
        });
      }

      // Fetch agent configuration from database
      const Agent = (await import('../models/Agent')).default;
      const agent = await Agent.findOne({ agent_id });
      
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'AGENT_NOT_FOUND',
            message: `Agent with id ${agent_id} not found in database`
          }
        });
      }

      console.log('[SIP Trunk Controller] Agent found:', {
        agent_id: agent.agent_id,
        name: agent.name,
        has_greeting_message: !!agent.greeting_message,
        has_system_prompt: !!agent.system_prompt,
        voice_id: agent.voice_id,
        language: agent.language
      });

      // ============================================
      // PRODUCTION-GRADE GREETING RENDERING PIPELINE
      // ============================================
      // SINGLE SOURCE OF TRUTH: All greeting rendering happens here
      // VALIDATION GATE: Blocks call if greeting is unsafe
      // ============================================
      
      const { 
        renderGreeting, 
        validateRenderedGreeting,
        getDefaultGreeting, 
        getDefaultSystemPrompt 
      } = await import('../utils/greetingRenderer');
      
      // STEP 1: Fetch customer info from database if not provided
      let finalCustomerInfo = customer_info || {};
      
      if (!finalCustomerInfo.name || !finalCustomerInfo.name.trim()) {
        try {
          const Customer = (await import('../models/Customer')).default;
          const organizationId = req.user?.organizationId || req.user?._id;
          
          if (organizationId && to_number) {
            const customer = await Customer.findOne({
              phone: to_number,
              organizationId: organizationId instanceof mongoose.Types.ObjectId 
                ? organizationId 
                : new mongoose.Types.ObjectId(organizationId.toString())
            }).lean();
            
            if (customer && customer.name) {
              finalCustomerInfo = {
                name: customer.name,
                email: customer.email || finalCustomerInfo.email || '',
                phone: to_number
              };
              console.log('[SIP Trunk Controller] ✅ Fetched customer from database');
            }
          }
        } catch (error: any) {
          console.warn('[SIP Trunk Controller] ⚠️ Failed to fetch customer from database:', error.message);
        }
      }
      
      // STEP 2: Prepare contact data with GUARANTEED non-empty name
      // CRITICAL: Name must be resolved BEFORE rendering (not during)
      let contactName = finalCustomerInfo?.name?.trim();
      if (!contactName || contactName.length === 0 || contactName === 'Unknown' || contactName === 'unknown') {
        contactName = 'there'; // Safe fallback
      }
      
      const contactData = {
        name: contactName,  // REQUIRED - never empty
        email: finalCustomerInfo?.email?.trim() || '',
        phone: to_number || ''
      };
      
      // STEP 3: Get greeting template
      const greetingTemplate = agent.greeting_message?.trim() 
        || agent.first_message?.trim() 
        || getDefaultGreeting(agent.language || 'en');
      
      if (!greetingTemplate || greetingTemplate.length === 0) {
        throw new Error('Greeting template is empty - cannot proceed with call');
      }
      
      // STEP 4: RENDER GREETING (SINGLE PASS, DETERMINISTIC)
      const renderingResult = renderGreeting(greetingTemplate, contactData, contactName);
      
      // STEP 5: VALIDATION GATE - BLOCK CALL IF UNSAFE
      if (!renderingResult.success) {
        console.error('[SIP Trunk Controller] ❌ FATAL: Greeting rendering failed:', renderingResult.errors);
        return res.status(400).json({
          success: false,
          error: {
            code: 'GREETING_RENDER_ERROR',
            message: `Failed to render greeting: ${renderingResult.errors.join('; ')}`,
            details: renderingResult.errors
          }
        });
      }
      
      // STEP 6: FINAL SAFETY CHECK - Validate rendered greeting is safe for TTS
      const safetyCheck = validateRenderedGreeting(renderingResult.rendered);
      if (!safetyCheck.safe) {
        console.error('[SIP Trunk Controller] ❌ FATAL: Rendered greeting is unsafe:', safetyCheck.reason);
        return res.status(400).json({
          success: false,
          error: {
            code: 'UNSAFE_GREETING',
            message: `Greeting is unsafe for TTS: ${safetyCheck.reason}`,
            rendered: renderingResult.rendered
          }
        });
      }
      
      // STEP 7: Get system prompt
      let systemPrompt = agent.system_prompt?.trim() 
        || getDefaultSystemPrompt(agent.language || 'en');
      
      if (!systemPrompt || systemPrompt.length === 0) {
        systemPrompt = getDefaultSystemPrompt(agent.language || 'en');
      }
      
      // STEP 8: Final values (guaranteed safe)
      const finalGreeting = renderingResult.rendered;
      const finalSystemPrompt = systemPrompt;
      
      // Log warnings if any
      if (renderingResult.warnings.length > 0) {
        console.warn('[SIP Trunk Controller] ⚠️ Rendering warnings:', renderingResult.warnings);
      }
      
      console.log('[SIP Trunk Controller] ✅ Greeting rendered successfully:', {
        template: greetingTemplate,
        rendered: finalGreeting,
        rendered_length: finalGreeting.length,
        customer_name: contactName,
        has_variables: finalGreeting.includes('{{'),
        system_prompt_length: finalSystemPrompt.length,
        language: agent.language,
        voice_id: agent.voice_id
      });

      // Fetch phone number from database to verify it exists and get details
      const PhoneNumber = (await import('../models/PhoneNumber')).default;
      const phoneNumber = await PhoneNumber.findOne({ 
        phone_number_id: agent_phone_number_id 
      });

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'PHONE_NUMBER_NOT_FOUND',
            message: `Phone number with id ${agent_phone_number_id} not found in database`
          }
        });
      }

      console.log('[SIP Trunk Controller] Phone number found:', {
        phone_number_id: phoneNumber.phone_number_id,
        phone_number: phoneNumber.phone_number,
        provider: phoneNumber.provider,
        label: phoneNumber.label,
        supports_outbound: phoneNumber.supports_outbound,
        has_outbound_config: !!phoneNumber.outbound_trunk_config
      });

      // Validate phone number supports outbound calls
      if (!phoneNumber.supports_outbound) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PHONE_NUMBER_NOT_OUTBOUND',
            message: `Phone number ${agent_phone_number_id} does not support outbound calls`
          }
        });
      }

      // Route by provider: Twilio uses a different Python API endpoint than SIP trunk
      let result;
      if (phoneNumber.provider === 'twilio') {
        // Twilio outbound: must use ElevenLabs phone_number_id
        // Auto-register if missing (for backward compatibility with existing numbers)
        if (!phoneNumber.elevenlabs_phone_number_id) {
          // Validate required fields for registration
          if (!phoneNumber.sid || !phoneNumber.token) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'MISSING_CREDENTIALS',
                message: `Twilio phone number ${agent_phone_number_id} is missing sid or token. Cannot register with ElevenLabs.`
              }
            });
          }

          console.log('[SIP Trunk Controller] Twilio number not registered, attempting auto-registration with ElevenLabs...');
          try {
            const elevenLabsResponse = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
              label: phoneNumber.label,
              phone_number: phoneNumber.phone_number,
              sid: phoneNumber.sid,
              token: phoneNumber.token,
              supports_inbound: phoneNumber.supports_inbound || false,
              supports_outbound: phoneNumber.supports_outbound || false
            });

            // Update phone number with ElevenLabs ID
            await PhoneNumber.updateOne(
              { phone_number_id: agent_phone_number_id },
              { $set: { elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id } }
            );

            phoneNumber.elevenlabs_phone_number_id = elevenLabsResponse.phone_number_id;
            console.log('[SIP Trunk Controller] ✅ Twilio number auto-registered with ElevenLabs:', elevenLabsResponse.phone_number_id);
          } catch (registerError: any) {
            // Registration failed - log full error details
            console.error('[SIP Trunk Controller] ❌ Auto-registration failed:', registerError.message);
            console.error('[SIP Trunk Controller] ❌ Error status:', registerError.statusCode);
            console.error('[SIP Trunk Controller] ❌ Error code:', registerError.code);
            console.error('[SIP Trunk Controller] ❌ Error response:', JSON.stringify(registerError.response?.data || {}, null, 2));
            
            // Don't fall back to phone number - registration is required
            return res.status(registerError.statusCode || 500).json({
              success: false,
              error: {
                code: registerError.code || 'REGISTRATION_ERROR',
                message: `Failed to register Twilio phone number with ElevenLabs: ${registerError.message}. Please try registering manually via POST /api/v1/phone-numbers/${agent_phone_number_id}/register`
              }
            });
          }
        }
        console.log('[SIP Trunk Controller] Using Twilio outbound endpoint; agent_phone_number_id:', phoneNumber.elevenlabs_phone_number_id, 'from_number:', phoneNumber.phone_number);
        
        try {
          result = await sipTrunkService.twilioOutboundCall({
            agent_id,
            agent_phone_number_id: phoneNumber.elevenlabs_phone_number_id,
            to_number,
            customer_info,
            sender_email,
            // Include agent configuration
            agent_config: {
              greeting_message: finalGreeting, // Use final validated greeting with all variables replaced
              system_prompt: finalSystemPrompt,
              voice_id: agent.voice_id,
              language: agent.language || 'en',
              escalationRules: agent.escalationRules
            },
            // Include credentials if using phone number as ID (not a registered ElevenLabs ID)
            ...(phoneNumber.elevenlabs_phone_number_id?.startsWith('+') && {
              phone_number: phoneNumber.phone_number,
              sid: phoneNumber.sid,
              token: phoneNumber.token
            })
          });
        } catch (callError: any) {
          // If phone number ID not found in Python API, try to re-register
          if (callError.code === 'PHONE_NUMBER_NOT_FOUND_IN_API' && phoneNumber.sid && phoneNumber.token) {
            console.log('[SIP Trunk Controller] ⚠️ Phone number ID not found in Python API, attempting re-registration...');
            try {
              const elevenLabsResponse = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
                label: phoneNumber.label,
                phone_number: phoneNumber.phone_number,
                sid: phoneNumber.sid,
                token: phoneNumber.token,
                supports_inbound: phoneNumber.supports_inbound || false,
                supports_outbound: phoneNumber.supports_outbound || false
              });

              // Update phone number with new ElevenLabs ID
              await PhoneNumber.updateOne(
                { phone_number_id: agent_phone_number_id },
                { $set: { elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id } }
              );

              phoneNumber.elevenlabs_phone_number_id = elevenLabsResponse.phone_number_id;
              console.log('[SIP Trunk Controller] ✅ Phone number re-registered with new ID:', elevenLabsResponse.phone_number_id);
              
              // Retry the call with the new ID
              result = await sipTrunkService.twilioOutboundCall({
                agent_id,
                agent_phone_number_id: elevenLabsResponse.phone_number_id,
                to_number,
                customer_info,
                sender_email,
                // Include agent configuration
                agent_config: {
                  greeting_message: finalGreeting,
                  system_prompt: finalSystemPrompt,
                  voice_id: agent.voice_id,
                  language: agent.language || 'en',
                  escalationRules: agent.escalationRules
                }
              });
              
              console.log('[SIP Trunk Controller] ✅ Outbound call succeeded after re-registration');
            } catch (registerError: any) {
              // Re-registration failed, return error
              console.error('[SIP Trunk Controller] ❌ Re-registration failed:', registerError.message);
              return res.status(registerError.statusCode || 500).json({
                success: false,
                error: {
                  code: registerError.code || 'REGISTRATION_ERROR',
                  message: `Phone number ID not found in Python API and re-registration failed: ${registerError.message}. Please try registering manually via POST /api/v1/phone-numbers/${agent_phone_number_id}/register`
                }
              });
            }
          } else {
            // Re-throw other errors
            throw callError;
          }
        }
      } else {
        // SIP trunk: must use ElevenLabs phone_number_id
        if (!phoneNumber.elevenlabs_phone_number_id) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'PHONE_NUMBER_NOT_REGISTERED',
              message: `Phone number ${agent_phone_number_id} is not registered with ElevenLabs. Please register it first via POST /api/v1/phone-numbers/${agent_phone_number_id}/register`
            }
          });
        }
        console.log('[SIP Trunk Controller] Using SIP trunk endpoint with ElevenLabs phone_number_id:', phoneNumber.elevenlabs_phone_number_id);
        result = await sipTrunkService.outboundCall({
          agent_id,
          agent_phone_number_id: phoneNumber.elevenlabs_phone_number_id,
          to_number,
          customer_info,
          sender_email,
          // Include agent configuration
          agent_config: {
            greeting_message: finalGreeting, // Use final validated greeting with all variables replaced
            system_prompt: finalSystemPrompt,
            voice_id: agent.voice_id,
            language: agent.language || 'en',
            escalationRules: agent.escalationRules
          }
        });
      }

      console.log('[SIP Trunk Controller] ✅ Outbound call initiated:');
      console.log(JSON.stringify(result, null, 2));

      // Create conversation for the outbound call so it appears in conversations tab
      if (result.success && result.conversation_id) {
        try {
          const Conversation = (await import('../models/Conversation')).default;
          const Customer = (await import('../models/Customer')).default;
          const Message = (await import('../models/Message')).default;
          const organizationId = req.user?.organizationId || req.user?._id;
          
          if (!organizationId) {
            console.warn('[SIP Trunk Controller] ⚠️ No organizationId found, skipping conversation creation');
          } else {
            // Find or create customer
            const customerPhone = to_number;
            const customerName = customer_info?.name || 'Unknown';
            const customerEmail = customer_info?.email;
            
            let customer = await Customer.findOne({
              phone: customerPhone,
              organizationId: organizationId instanceof mongoose.Types.ObjectId 
                ? organizationId 
                : new mongoose.Types.ObjectId(organizationId.toString())
            });
            
            if (!customer) {
              customer = await Customer.create({
                organizationId: organizationId instanceof mongoose.Types.ObjectId 
                  ? organizationId 
                  : new mongoose.Types.ObjectId(organizationId.toString()),
                name: customerName,
                phone: customerPhone,
                ...(customerEmail && { email: customerEmail }),
                source: 'phone'
              });
              console.log('[SIP Trunk Controller] ✅ Created customer:', customer._id);
            } else {
              // Update customer info if provided
              if (customerName !== 'Unknown' && customer.name !== customerName) {
                customer.name = customerName;
              }
              if (customerEmail && customer.email !== customerEmail) {
                customer.email = customerEmail;
              }
              await customer.save();
            }

            // Create conversation
            const conversation = await Conversation.create({
              organizationId: organizationId instanceof mongoose.Types.ObjectId 
                ? organizationId 
                : new mongoose.Types.ObjectId(organizationId.toString()),
              customerId: customer._id,
              channel: 'phone',
              status: 'open',
              isAiManaging: true,
              unread: true,
              metadata: {
                conversation_id: result.conversation_id, // Store Python API conversation_id - used to fetch transcript/recording
                callerId: result.conversation_id, // Also store as callerId for transcript polling compatibility
                callSid: (result as any).callSid || result.sip_call_id,
                phone_number_id: agent_phone_number_id,
                from_number: phoneNumber.phone_number,
                to_number: to_number,
                callInitiated: new Date(),
                provider: phoneNumber.provider
              }
            });

            // Add initial message indicating outbound call was initiated
            await Message.create({
              conversationId: conversation._id,
              type: 'internal_note',
              text: `Outbound call initiated to ${customerName} (${customerPhone})`,
              sender: 'ai',
              timestamp: new Date()
            });

            console.log('[SIP Trunk Controller] ✅ Created conversation:', conversation._id);
            console.log('[SIP Trunk Controller] Conversation will appear in conversations tab');
            
            // Add conversation ID to response so frontend can navigate to it
            (result as any).conversation_db_id = conversation._id.toString();
          }
        } catch (convError: any) {
          // Don't fail the call if conversation creation fails - log and continue
          console.error('[SIP Trunk Controller] ❌ Failed to create conversation:', convError.message);
          console.error('[SIP Trunk Controller] Error stack:', convError.stack);
        }
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const sipTrunkController = new SipTrunkController();

