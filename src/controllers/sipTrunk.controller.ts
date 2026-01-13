import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { sipTrunkService } from '../services/sipTrunk.service';
import { phoneSettingsService } from '../services/phoneSettings.service';
import { successResponse } from '../utils/response.util';

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
}

export const sipTrunkController = new SipTrunkController();

