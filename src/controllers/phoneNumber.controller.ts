import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import mongoose from 'mongoose';
import PhoneNumber from '../models/PhoneNumber';

export class PhoneNumberController {
  /**
   * List phone numbers
   * GET /api/v1/phone-numbers
   * Returns paginated list of phone numbers
   */
  list = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { cursor, page_size } = req.query;
      const pageSize = Math.min(Math.max(page_size ? Number(page_size) : 30, 1), 100);
      const organizationId = req.user?.organizationId || req.user?._id;
      const userId = req.user?._id;

      if (!organizationId && !userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      // Build query - check both organizationId and userId for backward compatibility
      // Some phone numbers might have been created with userId instead of organizationId
      const orgId = organizationId instanceof mongoose.Types.ObjectId 
        ? organizationId 
        : new mongoose.Types.ObjectId(organizationId.toString());
      const userObjId = userId instanceof mongoose.Types.ObjectId 
        ? userId 
        : new mongoose.Types.ObjectId(userId.toString());
      
      console.log('[PhoneNumber Controller] List - organizationId:', organizationId);
      console.log('[PhoneNumber Controller] List - userId:', userId);
      console.log('[PhoneNumber Controller] List - orgId (ObjectId):', orgId);
      console.log('[PhoneNumber Controller] List - userObjId (ObjectId):', userObjId);
      
      // Query for phone numbers that belong to either organization OR user
      const query: any = {
        $or: [
          { organizationId: orgId },
          ...(userId && orgId.toString() !== userObjId.toString() ? [{ organizationId: userObjId }] : [])
        ]
      };

      // Cursor-based pagination - if cursor provided, find documents after that cursor
      if (cursor) {
        const cursorDoc = await PhoneNumber.findOne({ phone_number_id: cursor });
        if (cursorDoc) {
          query.created_at_unix = { $lt: cursorDoc.created_at_unix };
        }
      }

      // Fetch one extra to check if there's a next page
      const phoneNumbers = await PhoneNumber.find(query)
        .sort({ created_at_unix: -1 })
        .limit(pageSize + 1)
        .lean();

      console.log('[PhoneNumber Controller] List - Found phone numbers:', phoneNumbers.length);
      console.log('[PhoneNumber Controller] List - Query:', JSON.stringify(query, null, 2));

      const hasMore = phoneNumbers.length > pageSize;
      const results = hasMore ? phoneNumbers.slice(0, pageSize) : phoneNumbers;
      const nextCursor = hasMore && results.length > 0 ? results[results.length - 1].phone_number_id : null;

        return res.json({
          phone_numbers: results.map(pn => ({
            phone_number_id: pn.phone_number_id,
            label: pn.label,
            phone_number: pn.phone_number,
            provider: pn.provider,
            // Default to true for twilio/sip_trunk so older records and new imports show in outbound dropdown
            supports_outbound: pn.supports_outbound ?? (pn.provider === 'twilio' || pn.provider === 'sip_trunk' || pn.provider === 'sip'),
            supports_inbound: pn.supports_inbound ?? (pn.provider === 'twilio'),
            elevenlabs_phone_number_id: pn.elevenlabs_phone_number_id,
            created_at_unix: pn.created_at_unix
          })),
          cursor: nextCursor
        });
    } catch (err: any) {
      console.error('[PhoneNumber Controller] List Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Create phone number - MINIMAL IMPLEMENTATION
   * POST /api/v1/phone-numbers
   * EXACT CONTRACT: Accept 4 fields, return phone_number_id
   * HARD STOP: No SIP setup, no agent config, no phone settings
   */
  create = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { label, phone_number, sid, token } = req.body;

      // Minimal validation - just check if 4 keys exist
      if (!label || !phone_number || !sid || !token) {
        return res.status(422).json({
          detail: [{
            loc: ["body"],
            msg: "Invalid request body",
            type: "value_error"
          }]
        });
      }

      // Generate phone_number_id
      const phoneNumberId = `phnum_${Math.random().toString(36).substring(2, 22)}`;

      // Create phone number - minimal schema
      // NO SIP SETUP, NO AGENT CONFIG, NO PHONE SETTINGS UPDATE
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const phoneNumberDoc = await PhoneNumber.create({
        phone_number_id: phoneNumberId,
        label,
        phone_number,
        sid,
        token,
        provider: 'twilio',
        supports_outbound: true, // Twilio numbers support outbound by default
        supports_inbound: true,  // Twilio numbers support inbound by default
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString()),
        created_at_unix: Math.floor(Date.now() / 1000)
      });

      // Register with ElevenLabs Python API if it's a Twilio number with outbound support
      // This is REQUIRED - ElevenLabs must know about the phone number before outbound calls
      // Twilio numbers support outbound by default
      {
        console.log('[PhoneNumber Controller] Registering Twilio phone number with ElevenLabs...');
        try {
          const { sipTrunkService } = await import('../services/sipTrunk.service');
          const elevenLabsResponse = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
            label,
            phone_number,
            sid,
            token,
            supports_inbound: true,
            supports_outbound: true
          });

          // Store ElevenLabs phone_number_id separately - DO NOT overwrite our internal ID
          await PhoneNumber.updateOne(
            { phone_number_id: phoneNumberId },
            { $set: { elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id } }
          );

          console.log('[PhoneNumber Controller] ✅ Twilio phone number registered with ElevenLabs');
          console.log('[PhoneNumber Controller] Internal phone_number_id:', phoneNumberId);
          console.log('[PhoneNumber Controller] ElevenLabs phone_number_id:', elevenLabsResponse.phone_number_id);
        } catch (registerError: any) {
          // Registration failure is critical - log but don't fail phone number creation
          // User can retry registration later
          console.error('[PhoneNumber Controller] ❌ ElevenLabs registration failed:', registerError.message);
          console.error('[PhoneNumber Controller] Error details:', {
            status: registerError.statusCode,
            code: registerError.code,
            message: registerError.message
          });
          console.warn('[PhoneNumber Controller] ⚠️ Phone number saved in MongoDB but NOT registered with ElevenLabs');
          console.warn('[PhoneNumber Controller] ⚠️ Outbound calls will fail until phone number is registered with ElevenLabs');
        }
      }

      // 🔴 VERY IMPORTANT: HARD RETURN - NOTHING AFTER THIS
      return res.status(201).json({
        phone_number_id: phoneNumberId
      });

      // ❌ NOTHING AFTER RETURN - NO SIP, NO AGENT, NO SETTINGS
    } catch (err: any) {
      console.error('[PhoneNumber Controller] Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Create SIP trunk phone number
   * POST /api/v1/phone-numbers/sip-trunk
   * EXACT CONTRACT: Accept SIP trunk config, return phone_number_id
   * HARD STOP: No agent config, no phone settings update
   */
  createSipTrunk = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        label,
        phone_number,
        provider = 'sip_trunk',
        supports_inbound = false,
        supports_outbound = true,
        inbound_trunk_config,
        outbound_trunk_config
      } = req.body;

      // Validation - required fields
      if (!label || !phone_number) {
        return res.status(422).json({
          detail: [{
            loc: ["body"],
            msg: "label and phone_number are required",
            type: "value_error"
          }]
        });
      }

      // Validate required field: provider
      if (!provider || provider !== 'sip_trunk') {
        return res.status(422).json({
          detail: [{
            loc: ["body", "provider"],
            msg: "provider is required and must be 'sip_trunk'",
            type: "value_error"
          }]
        });
      }

      // outbound_trunk_config is required if supports_outbound is true
      if (supports_outbound && !outbound_trunk_config) {
        return res.status(422).json({
          detail: [{
            loc: ["body", "outbound_trunk_config"],
            msg: "outbound_trunk_config is required when supports_outbound is true",
            type: "value_error"
          }]
        });
      }

      // inbound_trunk_config is required if supports_inbound is true
      if (supports_inbound && !inbound_trunk_config) {
        return res.status(422).json({
          detail: [{
            loc: ["body", "inbound_trunk_config"],
            msg: "inbound_trunk_config is required when supports_inbound is true",
            type: "value_error"
          }]
        });
      }

      // Generate phone_number_id
      const phoneNumberId = `phnum_${Math.random().toString(36).substring(2, 22)}`;

      // Create phone number with SIP trunk config
      // NO AGENT CONFIG, NO PHONE SETTINGS UPDATE
      const organizationId = req.user?.organizationId || req.user?._id;
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const phoneNumberDoc = await PhoneNumber.create({
        phone_number_id: phoneNumberId,
        label,
        phone_number,
        provider,
        sid: '', // Not used for SIP trunk
        token: '', // Not used for SIP trunk
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString()),
        created_at_unix: Math.floor(Date.now() / 1000),
        supports_inbound,
        supports_outbound,
        ...(inbound_trunk_config && { inbound_trunk_config }),
        ...(outbound_trunk_config && { outbound_trunk_config })
      });

      // Phone number is saved in MongoDB with all SIP trunk config
      console.log('[PhoneNumber Controller] ✅ Phone number saved in MongoDB with SIP trunk config');
      console.log('[PhoneNumber Controller] Phone number ID:', phoneNumberId);
      console.log('[PhoneNumber Controller] Supports outbound:', supports_outbound);
      console.log('[PhoneNumber Controller] Supports inbound:', supports_inbound);

      // Register with ElevenLabs Python API if it's a SIP trunk with outbound support
      // This is REQUIRED - ElevenLabs must know about the phone number before outbound calls
      if ((provider === 'sip_trunk' || provider === 'sip') && supports_outbound && outbound_trunk_config) {
        console.log('[PhoneNumber Controller] Registering SIP trunk phone number with ElevenLabs...');
        try {
          const { sipTrunkService } = await import('../services/sipTrunk.service');
          const elevenLabsResponse = await sipTrunkService.registerSipPhoneNumberWithElevenLabs({
            label,
            phone_number,
            provider,
            supports_inbound,
            supports_outbound,
            inbound_trunk_config,
            outbound_trunk_config
          });

          // Store ElevenLabs phone_number_id separately - DO NOT overwrite our internal ID
          await PhoneNumber.updateOne(
            { phone_number_id: phoneNumberId },
            { $set: { elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id } }
          );

          console.log('[PhoneNumber Controller] ✅ Phone number registered with ElevenLabs');
          console.log('[PhoneNumber Controller] Internal phone_number_id:', phoneNumberId);
          console.log('[PhoneNumber Controller] ElevenLabs phone_number_id:', elevenLabsResponse.phone_number_id);
        } catch (registerError: any) {
          // Registration failure is critical - log but don't fail phone number creation
          // User can retry registration later
          console.error('[PhoneNumber Controller] ❌ ElevenLabs registration failed:', registerError.message);
          console.error('[PhoneNumber Controller] Error details:', {
            status: registerError.statusCode,
            code: registerError.code,
            message: registerError.message
          });
          console.warn('[PhoneNumber Controller] ⚠️ Phone number saved in MongoDB but NOT registered with ElevenLabs');
          console.warn('[PhoneNumber Controller] ⚠️ Outbound calls will fail until phone number is registered with ElevenLabs');
        }
      }

      // 🔴 VERY IMPORTANT: HARD RETURN - NOTHING AFTER THIS
      return res.status(201).json({
        phone_number_id: phoneNumberId
      });

      // ❌ NOTHING AFTER RETURN - NO AGENT CONFIG, NO SETTINGS
    } catch (err: any) {
      console.error('[PhoneNumber Controller] SIP Trunk Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Register phone number with Python API
   * POST /api/v1/phone-numbers/:phone_number_id/register
   */
  registerWithPython = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { phone_number_id } = req.params;
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
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString())
      });

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: "Phone number not found",
          detail: `Phone number with ID ${phone_number_id} not found`
        });
      }

      // Validate phone number can be registered
      if (!phoneNumber.supports_outbound) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PHONE_NUMBER',
            message: 'Phone number must support outbound calls to register with ElevenLabs'
          }
        });
      }

      // SIP trunk validation
      if ((phoneNumber.provider === 'sip_trunk' || phoneNumber.provider === 'sip') && !phoneNumber.outbound_trunk_config) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PHONE_NUMBER',
            message: 'SIP trunk phone number must have outbound_trunk_config to register with ElevenLabs'
          }
        });
      }

      // Twilio validation
      if (phoneNumber.provider === 'twilio' && (!phoneNumber.sid || !phoneNumber.token)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PHONE_NUMBER',
            message: 'Twilio phone number must have sid and token to register with ElevenLabs'
          }
        });
      }

      // Check if already registered with ElevenLabs
      if (phoneNumber.elevenlabs_phone_number_id) {
        return res.status(200).json({
          success: true,
          message: 'Phone number is already registered with ElevenLabs',
          data: {
            phone_number_id: phoneNumber.phone_number_id,
            elevenlabs_phone_number_id: phoneNumber.elevenlabs_phone_number_id
          }
        });
      }

      // Register with ElevenLabs
      console.log('[PhoneNumber Controller] Registering existing phone number with ElevenLabs...');
      try {
        const { sipTrunkService } = await import('../services/sipTrunk.service');
        let elevenLabsResponse;

        if (phoneNumber.provider === 'twilio') {
          // Register Twilio number
          elevenLabsResponse = await sipTrunkService.registerTwilioPhoneNumberWithElevenLabs({
            label: phoneNumber.label,
            phone_number: phoneNumber.phone_number,
            sid: phoneNumber.sid!,
            token: phoneNumber.token!,
            supports_inbound: phoneNumber.supports_inbound || false,
            supports_outbound: phoneNumber.supports_outbound || false
          });
        } else {
          // Register SIP trunk number
          elevenLabsResponse = await sipTrunkService.registerSipPhoneNumberWithElevenLabs({
            label: phoneNumber.label,
            phone_number: phoneNumber.phone_number,
            provider: phoneNumber.provider || 'sip_trunk',
            supports_inbound: phoneNumber.supports_inbound || false,
            supports_outbound: phoneNumber.supports_outbound || false,
            inbound_trunk_config: phoneNumber.inbound_trunk_config,
            outbound_trunk_config: phoneNumber.outbound_trunk_config
          });
        }

        // Store ElevenLabs phone_number_id separately - DO NOT overwrite our internal ID
        await PhoneNumber.updateOne(
          { phone_number_id },
          { $set: { elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id } }
        );

        console.log('[PhoneNumber Controller] ✅ Phone number registered with ElevenLabs');
        console.log('[PhoneNumber Controller] Internal phone_number_id:', phoneNumber.phone_number_id);
        console.log('[PhoneNumber Controller] ElevenLabs phone_number_id:', elevenLabsResponse.phone_number_id);

        return res.status(200).json({
          success: true,
          message: 'Phone number registered successfully with ElevenLabs',
          data: {
            phone_number_id: phoneNumber.phone_number_id,
            elevenlabs_phone_number_id: elevenLabsResponse.phone_number_id
          }
        });
      } catch (registerError: any) {
        console.error('[PhoneNumber Controller] ❌ ElevenLabs registration failed:', registerError.message);
        console.error('[PhoneNumber Controller] Error details:', {
          status: registerError.statusCode,
          code: registerError.code,
          message: registerError.message
        });

        return res.status(registerError.statusCode || 500).json({
          success: false,
          error: {
            code: registerError.code || 'REGISTRATION_ERROR',
            message: registerError.message || 'Failed to register phone number with ElevenLabs',
            detail: registerError.response?.data || registerError.message
          }
        });
      }
    } catch (err: any) {
      console.error('[PhoneNumber Controller] Register Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Get phone number by ID
   * GET /api/v1/phone-numbers/:phone_number_id
   */
  getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { phone_number_id } = req.params;
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
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString())
      }).lean();

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: "Phone number not found",
          detail: `Phone number with ID ${phone_number_id} not found`
        });
      }

      return res.json({
        phone_number_id: phoneNumber.phone_number_id,
        phone_number: phoneNumber.phone_number,
        label: phoneNumber.label,
        provider: phoneNumber.provider,
        created_at_unix: phoneNumber.created_at_unix,
        ...(phoneNumber.supports_inbound !== undefined && { supports_inbound: phoneNumber.supports_inbound }),
        ...(phoneNumber.supports_outbound !== undefined && { supports_outbound: phoneNumber.supports_outbound }),
        ...(phoneNumber.inbound_trunk_config && { inbound_trunk_config: phoneNumber.inbound_trunk_config }),
        ...(phoneNumber.outbound_trunk_config && { outbound_trunk_config: phoneNumber.outbound_trunk_config })
      });
    } catch (err: any) {
      console.error('[PhoneNumber Controller] GetById Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Update phone number
   * PATCH /api/v1/phone-numbers/:phone_number_id
   */
  update = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { phone_number_id } = req.params;
      const { label, agent_id } = req.body;
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
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString())
      });

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: "Phone number not found",
          detail: `Phone number with ID ${phone_number_id} not found`
        });
      }

      // Update fields if provided
      if (label !== undefined) {
        phoneNumber.label = label;
      }
      if (agent_id !== undefined) {
        // Note: agent_id is not in the schema yet, but keeping it for API compatibility
        // You may need to add this field to the schema if needed
        (phoneNumber as any).agent_id = agent_id;
      }

      await phoneNumber.save();

      return res.json({
        phone_number_id: phoneNumber.phone_number_id,
        phone_number: phoneNumber.phone_number,
        label: phoneNumber.label,
        provider: phoneNumber.provider,
        created_at_unix: phoneNumber.created_at_unix,
        ...((phoneNumber as any).agent_id && { agent_id: (phoneNumber as any).agent_id })
      });
    } catch (err: any) {
      console.error('[PhoneNumber Controller] Update Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };

  /**
   * Delete phone number
   * DELETE /api/v1/phone-numbers/:phone_number_id
   */
  delete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { phone_number_id } = req.params;
      const organizationId = req.user?.organizationId || req.user?._id;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
          detail: "Organization ID or User ID not found"
        });
      }

      const phoneNumber = await PhoneNumber.findOneAndDelete({
        phone_number_id,
        organizationId: organizationId instanceof mongoose.Types.ObjectId ? organizationId : new mongoose.Types.ObjectId(organizationId.toString())
      });

      if (!phoneNumber) {
        return res.status(404).json({
          success: false,
          error: "Phone number not found",
          detail: `Phone number with ID ${phone_number_id} not found`
        });
      }

      return res.json({
        success: true,
        message: "Operation completed successfully"
      });
    } catch (err: any) {
      console.error('[PhoneNumber Controller] Delete Error:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        detail: err.message
      });
    }
  };
}

export const phoneNumberController = new PhoneNumberController();
