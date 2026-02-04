import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

// Use PYTHON_API_URL from environment variables (required for ElevenLabs API)
const PYTHON_API_URL = process.env.PYTHON_API_URL;
if (!PYTHON_API_URL) {
  throw new Error('PYTHON_API_URL is not configured in environment variables. This is required for ElevenLabs API calls.');
}
const COMM_API_URL = PYTHON_API_URL; // Alias for backward compatibility

/** Country codes that often require TLS instead of UDP (e.g. Italian +39 carriers) */
const TLS_PREFERRED_COUNTRY_CODES = ['39'];

function getSuggestedTransport(phoneNumber: string, currentTransport?: string): string | undefined {
  const digits = (phoneNumber || '').replace(/\D/g, '');
  if (digits.startsWith('39') && (!currentTransport || currentTransport === 'udp')) return 'tls';
  return undefined;
}

interface SetupSipTrunkRequest {
  label: string;
  phone_number: string;
  twilio_sid: string;
  twilio_auth_token: string;
}

interface SetupSipTrunkResponse {
  status: string;
  message: string;
  twilio_trunk_sid: string;
  livekit_trunk_id: string;
  termination_uri: string;
  credential_list_sid: string;
  ip_acl_sid: string;
  username: string;
  origination_uri: string;
  origination_uri_sid: string;
}

interface CreateLivekitTrunkRequest {
  label: string;
  phone_number: string;
  sip_address: string;
  username?: string;
  password?: string;
  transport?: string;
}

interface CreateLivekitTrunkResponse {
  status: string;
  message: string;
  livekit_trunk_id: string;
  sip_address: string;
  phone_number: string;
}

interface CreateGenericSipTrunkRequest {
  label: string;
  phone_number: string;
  sip_address: string;
  username: string;
  password: string;
  provider_name?: string;
  transport?: string;
  port?: number;
}

interface CreateGenericSipTrunkResponse {
  status: string;
  message: string;
  livekit_trunk_id: string;
  provider_name: string;
  sip_address: string;
  phone_number: string;
  transport: string;
}

interface CreateInboundTrunkRequest {
  name: string;
  phone_numbers: string[];
  allowed_numbers?: string[];
  krisp_enabled?: boolean;
}

interface CreateInboundTrunkResponse {
  status: string;
  message: string;
  trunk_id: string;
  trunk_name: string;
  phone_numbers: string[];
}

interface CreateDispatchRuleRequest {
  sip_trunk_id: string;
  name: string;
  agent_name: string;
}

interface CreateDispatchRuleResponse {
  status: string;
  message: string;
  dispatch_rule_id: string;
  dispatch_rule_name: string;
}

// Internal/Legacy request structure used by Controller (includes agent config overrides)
interface InternalOutboundCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  customer_info?: {
    email?: string;
    name?: string;
  };
  dynamic_variables?: Record<string, any>; // Explicit dynamic variables (highest priority)
  sender_email?: string;
  userId?: string; // Used for fetching e-commerce credentials
  // Agent configuration for call execution (Internal only - not sent to Python)
  agent_config?: {
    greeting_message?: string;
    system_prompt?: string;
    voice_id?: string;
    language?: string;
    escalationRules?: string[];
  };
}

// Strict payload structure for ElevenLabs API
interface OutboundCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  customer_info?: {
    email?: string;
    name?: string;
  };
  dynamic_variables: Record<string, any>; // REQUIRED - always included
  ecommerce_credentials?: {
    api_key: string;
    api_secret: string;
    base_url: string;
    platform: string;
    access_token?: string;
  };
  sender_email?: string;
}

/** Twilio outbound: uses agent_phone_number_id from ElevenLabs, with optional credentials for unregistered numbers */
interface TwilioOutboundCallRequest extends InternalOutboundCallRequest {
  phone_number?: string;  // E.164 from number (fallback if not registered)
  sid?: string;          // Twilio Account SID (fallback if not registered)
  token?: string;        // Twilio Auth Token (fallback if not registered)
}

interface OutboundCallResponse {
  success: boolean;
  message: string;
  conversation_id: string;
  sip_call_id?: string;
  callSid?: string; // Twilio call SID (for Twilio calls)
  ecommerce_enabled?: boolean;
}

export class SipTrunkService {
  /**
   * Setup SIP trunk with Twilio
   * Calls Python /calls/setup-sip-trunk endpoint
   */
  async setupSipTrunk(data: SetupSipTrunkRequest): Promise<SetupSipTrunkResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/calls/setup-sip-trunk`;

      console.log('[SIP Trunk Service] ===== CALLING PYTHON SERVICE =====');
      console.log('[SIP Trunk Service] Python API Base:', COMM_API_URL);
      console.log('[SIP Trunk Service] Full URL:', pythonUrl);
      console.log('[SIP Trunk Service] Method: POST');
      console.log('[SIP Trunk Service] Request payload:', {
        label: data.label,
        phone_number: data.phone_number,
        twilio_sid: data.twilio_sid,
        twilio_auth_token: '***hidden***'
      });

      const response = await axios.post<SetupSipTrunkResponse>(
        pythonUrl,
        {
          label: data.label,
          phone_number: data.phone_number,
          twilio_sid: data.twilio_sid,
          twilio_auth_token: data.twilio_auth_token
        },
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Python response received');
      console.log('[SIP Trunk Service] Status:', response.status);
      console.log('[SIP Trunk Service] Full response body:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('[SIP Trunk Service] Response fields breakdown:');
      console.log('  - status:', response.data.status);
      console.log('  - message:', response.data.message);
      console.log('  - livekit_trunk_id:', response.data.livekit_trunk_id);
      console.log('  - twilio_trunk_sid:', response.data.twilio_trunk_sid);
      console.log('  - termination_uri:', response.data.termination_uri);
      console.log('  - origination_uri:', response.data.origination_uri);
      console.log('  - credential_list_sid:', response.data.credential_list_sid);
      console.log('  - ip_acl_sid:', response.data.ip_acl_sid);
      console.log('  - username:', response.data.username);
      console.log('  - origination_uri_sid:', response.data.origination_uri_sid);

      return response.data;
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to setup Twilio SIP trunk:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'SIP_TRUNK_SETUP_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to setup SIP trunk with Twilio'
      );
    }
  }

  // /**
  //  * Create LiveKit SIP trunk
  //  * Calls Python /calls/create-livekit-trunk endpoint
  //  */
  // async createLivekitTrunk(data: CreateLivekitTrunkRequest): Promise<CreateLivekitTrunkResponse> {
  //   try {
  //     console.log('[SIP Trunk] Creating LiveKit SIP trunk...');

  //     const response = await axios.post<CreateLivekitTrunkResponse>(
  //       `${COMM_API_URL}/calls/create-livekit-trunk`,
  //       {
  //         label: data.label,
  //         phone_number: data.phone_number,
  //         sip_address: data.sip_address,
  //         username: data.username || 'username',
  //         password: data.password || 'password',
  //         transport: data.transport || 'udp'
  //       },
  //       {
  //         timeout: 60000 // 60 seconds timeout
  //       }
  //     );

  //     console.log('[SIP Trunk] ✅ LiveKit SIP trunk created successfully');
  //     console.log('[SIP Trunk] LiveKit Trunk ID:', response.data.livekit_trunk_id);

  //     return response.data;
  //   } catch (error: any) {
  //     console.error('[SIP Trunk] ❌ Failed to create LiveKit SIP trunk:', error.response?.data || error.message);
  //     throw new AppError(
  //       error.response?.status || 500,
  //       'LIVEKIT_TRUNK_ERROR',
  //       error.response?.data?.message || error.response?.data?.detail || 'Failed to create LiveKit SIP trunk'
  //     );
  //   }
  // }

  /**
   * Create Generic SIP trunk
   * Calls Python /calls/create-generic-sip-trunk endpoint
   */
  async createGenericSipTrunk(data: CreateGenericSipTrunkRequest): Promise<CreateGenericSipTrunkResponse> {
    try {
      // Try multiple possible endpoints for SIP trunk registration
      // The correct endpoint structure may vary
      const possibleEndpoints = [
        `${COMM_API_URL}/api/v1/sip-trunk/create-generic`,
        `${COMM_API_URL}/api/v1/sip-trunk`,
        `${COMM_API_URL}/calls/create-generic-sip-trunk`
      ];

      let lastError: any = null;
      let response: any = null;

      for (const pythonUrl of possibleEndpoints) {
        try {
          const suggestedTransport = getSuggestedTransport(data.phone_number, data.transport);
          console.log('[SIP Trunk Service] ===== CREATING GENERIC SIP TRUNK =====');
          console.log('[SIP Trunk Service] phone_number:', data.phone_number, '| transport:', data.transport || 'udp', suggestedTransport ? `| hint: try "${suggestedTransport}" if errors` : '');
          console.log('[SIP Trunk Service] Request payload:', {
            label: data.label,
            phone_number: data.phone_number,
            sip_address: data.sip_address,
            username: data.username,
            password: '***hidden***',
            provider_name: data.provider_name || 'generic',
            transport: data.transport || 'udp',
            port: data.port || 5060
          });

          response = await axios.post<CreateGenericSipTrunkResponse>(
            pythonUrl,
            {
              label: data.label,
              phone_number: data.phone_number,
              sip_address: data.sip_address,
              username: data.username,
              password: data.password,
              provider_name: data.provider_name || 'generic',
              transport: data.transport || 'udp',
              port: data.port || 5060
            },
            {
              timeout: 60000 // 60 seconds timeout
            }
          );

          // Success - break out of loop
          console.log('[SIP Trunk Service] ✅ Generic SIP trunk created successfully');
          console.log('[SIP Trunk Service] Working endpoint:', pythonUrl);
          break;
        } catch (error: any) {
          lastError = error;
          // If 404, try next endpoint
          if (error.response?.status === 404) {
            console.warn(`[SIP Trunk Service] Endpoint ${pythonUrl} returned 404, trying next...`);
            continue;
          }
          // For other errors, throw immediately
          throw error;
        }
      }

      // If we have a successful response, return it
      if (response && response.data) {
        console.log('[SIP Trunk Service] Response status:', response.status);
        console.log('[SIP Trunk Service] Response body:');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('[SIP Trunk Service] Response fields:');
        console.log('  - status:', response.data.status);
        console.log('  - message:', response.data.message);
        console.log('  - livekit_trunk_id:', response.data.livekit_trunk_id);
        console.log('  - provider_name:', response.data.provider_name);
        console.log('  - sip_address:', response.data.sip_address);
        console.log('  - phone_number:', response.data.phone_number);
        console.log('  - transport:', response.data.transport);
        return response.data;
      }

      throw lastError || new Error('All SIP trunk registration endpoints failed');
    } catch (error: any) {
      const transport = data.transport || 'udp';
      const suggestedTransport = getSuggestedTransport(data.phone_number, transport);
      const errMsg = error.response?.data?.message || error.response?.data?.detail || error.message;

      console.error('[SIP Trunk] ❌ CREATE GENERIC SIP TRUNK FAILED', {
        phone_number: data.phone_number,
        transport,
        status: error.response?.status,
        error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg).slice(0, 200)
      });
      if (suggestedTransport) {
        console.error('[SIP Trunk] 💡 For +39 (Italy) numbers, try transport:', suggestedTransport);
      }
      if (error.response?.data && typeof error.response.data === 'object') {
        console.error('[SIP Trunk] Full error:', JSON.stringify(error.response.data, null, 2));
      }

      const userMessage = suggestedTransport
        ? `${String(errMsg)} For +39 numbers, try transport "${suggestedTransport}" instead of "${transport}".`
        : (typeof errMsg === 'string' ? errMsg : 'Failed to create Generic SIP trunk');

      throw new AppError(error.response?.status || 500, 'GENERIC_SIP_TRUNK_ERROR', userMessage);
    }
  }

  /**
   * Create Inbound trunk
   * Calls Python /calls/create-inbound-trunk endpoint
   */
  async createInboundTrunk(data: CreateInboundTrunkRequest): Promise<CreateInboundTrunkResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/calls/create-inbound-trunk`;

      console.log('[SIP Trunk Service] ===== CREATING INBOUND TRUNK =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Request payload:', {
        name: data.name,
        phone_numbers: data.phone_numbers,
        allowed_numbers: data.allowed_numbers || [],
        krisp_enabled: data.krisp_enabled !== undefined ? data.krisp_enabled : true
      });

      const response = await axios.post<CreateInboundTrunkResponse>(
        pythonUrl,
        {
          name: data.name,
          phone_numbers: data.phone_numbers,
          allowed_numbers: data.allowed_numbers || [],
          krisp_enabled: data.krisp_enabled !== undefined ? data.krisp_enabled : true
        },
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Inbound trunk created successfully');
      console.log('[SIP Trunk Service] Response status:', response.status);
      console.log('[SIP Trunk Service] Response body:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('[SIP Trunk Service] Response fields:');
      console.log('  - status:', response.data.status);
      console.log('  - message:', response.data.message);
      console.log('  - trunk_id:', response.data.trunk_id);
      console.log('  - trunk_name:', response.data.trunk_name);
      console.log('  - phone_numbers:', response.data.phone_numbers);

      return response.data;
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to create inbound trunk:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'INBOUND_TRUNK_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to create inbound trunk'
      );
    }
  }

  /**
   * Create Dispatch Rule
   * Calls Python /calls/create-dispatch-rule endpoint
   */
  async createDispatchRule(data: CreateDispatchRuleRequest): Promise<CreateDispatchRuleResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/calls/create-dispatch-rule`;

      console.log('[SIP Trunk Service] ===== CREATING DISPATCH RULE =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Request payload:', {
        sip_trunk_id: data.sip_trunk_id,
        name: data.name,
        agent_name: data.agent_name
      });

      const response = await axios.post<CreateDispatchRuleResponse>(
        pythonUrl,
        {
          sip_trunk_id: data.sip_trunk_id,
          name: data.name,
          agent_name: data.agent_name
        },
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Dispatch rule created successfully');
      console.log('[SIP Trunk Service] Response status:', response.status);
      console.log('[SIP Trunk Service] Response body:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('[SIP Trunk Service] Response fields:');
      console.log('  - status:', response.data.status);
      console.log('  - message:', response.data.message);
      console.log('  - dispatch_rule_id:', response.data.dispatch_rule_id);
      console.log('  - dispatch_rule_name:', response.data.dispatch_rule_name);

      return response.data;
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to create dispatch rule:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'DISPATCH_RULE_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to create dispatch rule'
      );
    }
  }

  /**
   * Register Twilio phone number with ElevenLabs Python API
   * POST /api/v1/phone-numbers (Import Phone Number for Twilio)
   * This MUST be called to register the phone number before making outbound calls
   * Matches ElevenLabs API schema exactly
   */
  async registerTwilioPhoneNumberWithElevenLabs(data: {
    label: string;
    phone_number: string;
    sid: string;
    token: string;
    supports_inbound?: boolean;
    supports_outbound?: boolean;
  }): Promise<{ phone_number_id: string }> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers`;

      // Build payload matching ElevenLabs API schema exactly
      // According to API docs: POST /api/v1/phone-numbers - Import Phone Number (Twilio)
      const payload: any = {
        label: data.label,
        phone_number: data.phone_number,
        sid: data.sid,
        token: data.token,
        supports_inbound: data.supports_inbound ?? true,
        supports_outbound: data.supports_outbound ?? true
      };

      console.log('[SIP Trunk Service] ===== REGISTERING TWILIO PHONE NUMBER WITH ELEVENLABS =====');
      console.log('[SIP Trunk Service] ElevenLabs Python API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Request payload:', {
        label: payload.label,
        phone_number: payload.phone_number,
        sid: '***',
        token: '***',
        supports_inbound: payload.supports_inbound,
        supports_outbound: payload.supports_outbound
      });

      const response = await axios.post<any>(
        pythonUrl,
        payload,
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Twilio phone number registered with ElevenLabs');
      console.log('[SIP Trunk Service] Response status:', response.status);
      console.log('[SIP Trunk Service] Full response:', JSON.stringify(response.data, null, 2));

      // Handle different possible response formats
      const phoneNumberId = response.data?.phone_number_id || response.data?.id || response.data?.phoneNumberId;

      if (!phoneNumberId) {
        console.error('[SIP Trunk Service] ❌ Response does not contain phone_number_id:', response.data);
        throw new Error('Registration response does not contain phone_number_id');
      }

      console.log('[SIP Trunk Service] ElevenLabs phone_number_id:', phoneNumberId);

      return { phone_number_id: phoneNumberId };
    } catch (error: any) {
      // If phone number already exists (409 Conflict or similar), try to fetch it
      if (error.response?.status === 409 || error.response?.status === 400) {
        console.log('[SIP Trunk Service] Phone number may already exist, attempting to fetch existing phone number...');
        try {
          // Try to list phone numbers and find this one
          const listResponse = await axios.get<any>(`${COMM_API_URL}/api/v1/phone-numbers`, {
            timeout: 60000
          });

          const existingNumber = listResponse.data?.phone_numbers?.find(
            (pn: any) => pn.phone_number === data.phone_number
          );

          if (existingNumber?.phone_number_id) {
            console.log('[SIP Trunk Service] ✅ Found existing phone number:', existingNumber.phone_number_id);
            return { phone_number_id: existingNumber.phone_number_id };
          }
        } catch (fetchError: any) {
          console.warn('[SIP Trunk Service] Failed to fetch existing phone number:', fetchError.message);
        }
      }

      console.error('[SIP Trunk Service] ❌ Failed to register Twilio phone number with ElevenLabs:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'ELEVENLABS_REGISTRATION_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to register Twilio phone number with ElevenLabs'
      );
    }
  }

  /**
   * Register SIP trunk phone number with ElevenLabs Python API
   * POST /api/v1/phone-numbers/sip-trunk (ElevenLabs endpoint)
   * This MUST be called to register the phone number before making outbound calls
   * Matches ElevenLabs API schema exactly
   */
  async registerSipPhoneNumberWithElevenLabs(data: {
    label: string;
    phone_number: string;
    provider: string;
    supports_inbound: boolean;
    supports_outbound: boolean;
    inbound_trunk_config?: {
      address: string;
      // Note: credentials are not required for inbound-only configuration
    };
    outbound_trunk_config?: {
      address: string;
      credentials: {
        username: string;
        password: string;
      };
      media_encryption?: string;
      transport?: string;
    };
  }): Promise<{ phone_number_id: string }> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers/sip-trunk`;

      // Build payload matching ElevenLabs API schema exactly
      const payload: any = {
        label: data.label,
        phone_number: data.phone_number,
        provider: data.provider,
        supports_inbound: data.supports_inbound,
        supports_outbound: data.supports_outbound
      };

      if (data.inbound_trunk_config) {
        // For inbound-only: only include address, no credentials
        payload.inbound_trunk_config = {
          address: data.inbound_trunk_config.address
        };
      }

      if (data.outbound_trunk_config) {
        payload.outbound_trunk_config = {
          address: data.outbound_trunk_config.address,
          credentials: {
            username: data.outbound_trunk_config.credentials.username,
            password: data.outbound_trunk_config.credentials.password
          }
        };
        if (data.outbound_trunk_config.media_encryption) {
          payload.outbound_trunk_config.media_encryption = data.outbound_trunk_config.media_encryption;
        }
        if (data.outbound_trunk_config.transport) {
          payload.outbound_trunk_config.transport = data.outbound_trunk_config.transport;
        }
      }

      const transport = data.outbound_trunk_config?.transport || data.inbound_trunk_config ? 'udp' : 'n/a';
      const suggestedTransport = getSuggestedTransport(data.phone_number, transport);

      console.log('[SIP Trunk Service] ===== REGISTERING SIP PHONE NUMBER WITH ELEVENLABS =====');
      console.log('[SIP Trunk Service] phone_number:', data.phone_number, '| transport:', transport, suggestedTransport ? `| hint: try transport "${suggestedTransport}" if errors` : '');
      console.log('[SIP Trunk Service] Request payload:', {
        ...payload,
        inbound_trunk_config: payload.inbound_trunk_config ? { ...payload.inbound_trunk_config, credentials: { ...payload.inbound_trunk_config.credentials, password: '***hidden***' } } : undefined,
        outbound_trunk_config: payload.outbound_trunk_config ? { ...payload.outbound_trunk_config, credentials: { ...payload.outbound_trunk_config.credentials, password: '***hidden***' } } : undefined
      });

      const response = await axios.post<{ phone_number_id: string }>(
        pythonUrl,
        payload,
        { timeout: 60000 }
      );

      console.log('[SIP Trunk Service] ✅ Phone number registered with ElevenLabs | phone_number_id:', response.data.phone_number_id);
      return response.data;
    } catch (error: any) {
      const transport = data.outbound_trunk_config?.transport || 'udp';
      const suggestedTransport = getSuggestedTransport(data.phone_number, transport);
      const errMsg = error.response?.data?.message || error.response?.data?.detail || error.message;

      console.error('[SIP Trunk Service] ❌ REGISTER FAILED', {
        phone_number: data.phone_number,
        transport,
        status: error.response?.status,
        error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg).slice(0, 200)
      });
      if (suggestedTransport) {
        console.error('[SIP Trunk Service] 💡 For +39 (Italy) numbers, transport mismatch often causes errors. Try transport:', suggestedTransport);
      }
      if (error.response?.data && typeof error.response.data === 'object') {
        console.error('[SIP Trunk Service] Full error response:', JSON.stringify(error.response.data, null, 2));
      }

      const userMessage = suggestedTransport
        ? `${String(errMsg)} For +39 numbers, try using transport "${suggestedTransport}" instead of "${transport}".`
        : (typeof errMsg === 'string' ? errMsg : 'Failed to register phone number with ElevenLabs');

      throw new AppError(error.response?.status || 500, 'ELEVENLABS_REGISTRATION_ERROR', userMessage);
    }
  }

  /**
   * Assign agent to phone number using ElevenLabs API
   * PATCH /api/v1/phone-numbers/{phone_number_id}
   */
  async assignAgentToPhoneNumber(phone_number_id: string, agent_id: string): Promise<{ phone_number_id: string; agent_id: string }> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers/${encodeURIComponent(phone_number_id)}`;

      console.log('[SIP Trunk Service] ===== ASSIGNING AGENT TO PHONE NUMBER =====');
      console.log('[SIP Trunk Service] ElevenLabs API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Request payload:', {
        agent_id: agent_id
      });

      const response = await axios.patch<any>(
        pythonUrl,
        {
          agent_id: agent_id
        },
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Agent assigned to phone number successfully');
      console.log('[SIP Trunk Service] Response status:', response.status);
      console.log('[SIP Trunk Service] Response body:', JSON.stringify(response.data, null, 2));

      return {
        phone_number_id: response.data.phone_number_id || phone_number_id,
        agent_id: response.data.agent_id || agent_id
      };
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to assign agent to phone number:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'AGENT_ASSIGNMENT_ERROR',
        error.response?.data?.message || error.response?.data?.detail || `Failed to assign agent ${agent_id} to phone number ${phone_number_id}`
      );
    }
  }

  /**
   * Update phone number in ElevenLabs API
   * PATCH /api/v1/phone-numbers/{phone_number_id}
   * Updates phone number configuration (e.g., assign agent, update SIP trunk settings)
   */
  async updatePhoneNumberInElevenLabs(
    phone_number_id: string,
    updateData: {
      label?: string;
      agent_id?: string | null;
      supports_inbound?: boolean;
      supports_outbound?: boolean;
      inbound_trunk_config?: {
        address: string;
        credentials: {
          username: string;
          password: string;
        };
        media_encryption?: string;
        transport?: string;
      };
      outbound_trunk_config?: {
        address: string;
        credentials: {
          username: string;
          password: string;
        };
        media_encryption?: string;
        transport?: string;
      };
    }
  ): Promise<any> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers/${encodeURIComponent(phone_number_id)}`;

      console.log('[SIP Trunk Service] ===== UPDATING PHONE NUMBER IN ELEVENLABS =====');
      console.log('[SIP Trunk Service] ElevenLabs API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Request payload:', {
        ...updateData,
        ...(updateData.inbound_trunk_config && {
          inbound_trunk_config: {
            ...updateData.inbound_trunk_config,
            credentials: {
              ...updateData.inbound_trunk_config.credentials,
              password: '***hidden***'
            }
          }
        }),
        ...(updateData.outbound_trunk_config && {
          outbound_trunk_config: {
            ...updateData.outbound_trunk_config,
            credentials: {
              ...updateData.outbound_trunk_config.credentials,
              password: '***hidden***'
            }
          }
        })
      });

      const response = await axios.patch<any>(
        pythonUrl,
        updateData,
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      console.log('[SIP Trunk Service] ✅ Phone number updated in ElevenLabs successfully');
      console.log('[SIP Trunk Service] Response status:', response.status);
      console.log('[SIP Trunk Service] Response body:', JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error: any) {
      console.error('[SIP Trunk Service] ❌ Failed to update phone number in ElevenLabs:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'PHONE_NUMBER_UPDATE_ERROR',
        error.response?.data?.message || error.response?.data?.detail || `Failed to update phone number ${phone_number_id} in ElevenLabs`
      );
    }
  }

  /**
   * Get phone number ID from ElevenLabs API by phone number string
   * GET /api/v1/phone-numbers and find matching phone_number
   */
  async getPhoneNumberIdByPhoneNumber(phone_number: string): Promise<string | null> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers`;

      console.log('[SIP Trunk Service] ===== FETCHING PHONE NUMBER ID =====');
      console.log('[SIP Trunk Service] ElevenLabs API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Looking for phone number:', phone_number);

      const response = await axios.get<any>(
        pythonUrl,
        {
          timeout: 60000 // 60 seconds timeout
        }
      );

      const phoneNumbers = response.data?.phone_numbers || [];
      const matchingNumber = phoneNumbers.find((pn: any) => pn.phone_number === phone_number);

      if (matchingNumber?.phone_number_id) {
        console.log('[SIP Trunk Service] ✅ Found phone number ID:', matchingNumber.phone_number_id);
        return matchingNumber.phone_number_id;
      }

      console.warn('[SIP Trunk Service] ⚠️ Phone number not found in ElevenLabs:', phone_number);
      return null;
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to fetch phone number ID:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Assign agent to multiple phone numbers
   * For each phone number, finds its phone_number_id and assigns the agent
   */
  async assignAgentToPhoneNumbers(phone_numbers: string[], agent_id: string): Promise<Array<{ phone_number: string; phone_number_id: string; success: boolean; error?: string }>> {
    const results = [];

    for (const phone_number of phone_numbers) {
      try {
        // Get phone_number_id from ElevenLabs
        const phone_number_id = await this.getPhoneNumberIdByPhoneNumber(phone_number);

        if (!phone_number_id) {
          results.push({
            phone_number,
            phone_number_id: '',
            success: false,
            error: `Phone number ${phone_number} not found in ElevenLabs. Please register it first.`
          });
          continue;
        }

        // Assign agent
        await this.assignAgentToPhoneNumber(phone_number_id, agent_id);

        results.push({
          phone_number,
          phone_number_id,
          success: true
        });
      } catch (error: any) {
        results.push({
          phone_number,
          phone_number_id: '',
          success: false,
          error: error.message || 'Failed to assign agent'
        });
      }
    }

    return results;
  }

  /**
   * Initiate outbound call via Twilio
   * Calls Python /api/v1/phone-numbers/twilio/outbound-call
   * Numbers imported via POST /api/v1/phone-numbers (label, phone_number, sid, token).
   * If agent_phone_number_id looks like a phone number (starts with +), include credentials as fallback.
   */
  async twilioOutboundCall(data: TwilioOutboundCallRequest): Promise<OutboundCallResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/phone-numbers/twilio/outbound-call`;
      console.log('[SIP Trunk Service] ===== INITIATING TWILIO OUTBOUND CALL =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);

      // Fetch e-commerce credentials if userId is provided
      let ecommerceCredentials = undefined;
      if (data.userId) {
        try {
          const { getEcommerceCredentials } = await import('../utils/ecommerce.util');
          ecommerceCredentials = await getEcommerceCredentials(data.userId);
          if (ecommerceCredentials) {
            console.log('[SIP Trunk Service] ✅ Found e-commerce credentials for user, attaching to payload');
          }
        } catch (err) {
          console.warn('[SIP Trunk Service] ⚠️ Failed to fetch e-commerce credentials:', err);
        }
      }

      // Build dynamic_variables by merging customer_info and explicit dynamic_variables
      const { buildDynamicVariables } = await import('../utils/dynamicVariables.util');
      const dynamicVariables = buildDynamicVariables(
        data.customer_info,
        data.dynamic_variables
      );

      // Log dynamic variables
      if (!data.dynamic_variables) {
        console.warn('[Dynamic Variables] Missing in request — injecting from customer_info');
      }
      console.log(
        '[Dynamic Variables] Final payload variables:',
        JSON.stringify(dynamicVariables, null, 2)
      );

      // Build payload matching ElevenLabs API schema
      const body: Record<string, unknown> = {
        agent_id: data.agent_id,
        agent_phone_number_id: data.agent_phone_number_id,
        to_number: data.to_number,
        customer_info: {
          name: (data.customer_info?.name || "there").trim(),
          email: (data.customer_info?.email || "").trim()
        },
        dynamic_variables: dynamicVariables, // ALWAYS include - never omit
        ...(ecommerceCredentials && { ecommerce_credentials: ecommerceCredentials })
      };

      // Only include sender_email if defined
      if (data.sender_email) {
        body.sender_email = data.sender_email;
      }

      // Include agent configuration if provided
      // NOTE: Greeting is already validated and rendered in controller
      // This layer just passes it through - NO additional processing
      if (data.agent_config) {
        // Greeting message is already rendered and validated - use as-is
        if (data.agent_config.greeting_message && typeof data.agent_config.greeting_message === 'string') {
          const greetingMessage = data.agent_config.greeting_message.trim();

          // Final sanity check: If somehow variables got through, BLOCK the call
          if (greetingMessage.includes('{{') || greetingMessage.includes('}}')) {
            console.error('[SIP Trunk Service] ❌ FATAL: Variables detected in greeting message!');
            throw new AppError(
              400,
              'UNSAFE_GREETING',
              'Greeting message contains unresolved variables - call blocked for safety'
            );
          }

          if (greetingMessage.length === 0) {
            console.error('[SIP Trunk Service] ❌ FATAL: Greeting message is empty!');
            throw new AppError(
              400,
              'EMPTY_GREETING',
              'Greeting message is empty - call blocked'
            );
          }

          body.greeting_message = greetingMessage;
          // Also send as first_message for Python API compatibility
          body.first_message = greetingMessage;
        }

        // System prompt validation
        if (data.agent_config.system_prompt && typeof data.agent_config.system_prompt === 'string') {
          const systemPrompt = data.agent_config.system_prompt.trim();
          if (systemPrompt.length === 0) {
            throw new AppError(
              400,
              'EMPTY_SYSTEM_PROMPT',
              'System prompt is empty - call blocked'
            );
          }
          body.system_prompt = systemPrompt;
        }

        // Always include language - it's required for proper agent behavior
        body.language = data.agent_config.language || 'en';
        if (data.agent_config.voice_id) {
          body.voice_id = data.agent_config.voice_id;
        }
        if (data.agent_config.escalationRules && data.agent_config.escalationRules.length > 0) {
          body.escalationRules = data.agent_config.escalationRules;
        }
      }

      // If agent_phone_number_id looks like a phone number (not a registered ID),
      // include credentials as fallback - Python API might handle Twilio dynamically
      if (data.agent_phone_number_id?.startsWith('+') && data.phone_number && data.sid && data.token) {
        console.log('[SIP Trunk Service] ⚠️ Using phone number as ID - including credentials as fallback');
        body.phone_number = data.phone_number;
        body.sid = data.sid;
        body.token = data.token;
      }

      const greetingMsg = typeof body.greeting_message === 'string' ? body.greeting_message : '';
      const firstMsg = typeof body.first_message === 'string' ? body.first_message : '';
      const systemPrompt = typeof body.system_prompt === 'string' ? body.system_prompt : '';

      // CRITICAL: Final validation before sending to Python API
      if (greetingMsg && (greetingMsg.includes('{{') || greetingMsg.includes('}}'))) {
        console.error('[SIP Trunk Service] ❌ FATAL: Variables detected in greeting!', {
          greeting: greetingMsg.substring(0, 200)
        });
        throw new AppError(
          500,
          'UNSAFE_GREETING',
          'Greeting contains unresolved variables - this should never happen. Call blocked.'
        );
      }

      // Ensure required fields are always present
      // Python API may require these fields even if not in agent_config
      if (!body.greeting_message && !body.first_message) {
        // Use default greeting if neither is provided
        const { getDefaultGreeting } = await import('../utils/greetingRenderer');
        const defaultGreeting = getDefaultGreeting(body.language as string || 'en');
        body.greeting_message = defaultGreeting;
        body.first_message = defaultGreeting;
        console.warn('[SIP Trunk Service] ⚠️ No greeting message provided, using default');
      }

      if (!body.system_prompt) {
        // Use default system prompt if not provided
        const { getDefaultSystemPrompt } = await import('../utils/greetingRenderer');
        body.system_prompt = getDefaultSystemPrompt(body.language as string || 'en');
        console.warn('[SIP Trunk Service] ⚠️ No system prompt provided, using default');
      }

      if (!body.language) {
        body.language = 'en';
        console.warn('[SIP Trunk Service] ⚠️ No language provided, defaulting to en');
      }

      console.log('[SIP Trunk Service] ✅ Final payload validated:', {
        agent_id: body.agent_id,
        agent_phone_number_id: body.agent_phone_number_id,
        to_number: body.to_number,
        greeting_message: body.greeting_message ? `${String(body.greeting_message).substring(0, 80)}...` : 'MISSING',
        first_message: body.first_message ? `${String(body.first_message).substring(0, 80)}...` : 'MISSING',
        system_prompt: body.system_prompt ? `${String(body.system_prompt).substring(0, 80)}...` : 'MISSING',
        voice_id: body.voice_id || 'NOT_SET',
        language: body.language || 'NOT_SET',
        has_variables: false // Should always be false after validation
      });

      // Log BEFORE calling Python outbound-call
      console.log(
        '[OUTBOUND CALL → PYTHON] Payload:',
        JSON.stringify(body, null, 2)
      );

      // Wrap in try/catch to log success OR failure
      try {
        const response = await axios.post<OutboundCallResponse>(
          pythonUrl,
          body,
          { timeout: 60000 }
        );

        // Log AFTER Python responds (success)
        console.log(
          '[OUTBOUND CALL ← PYTHON] Response:',
          JSON.stringify(response.data, null, 2)
        );

        console.log('[SIP Trunk Service] ✅ Twilio outbound call initiated');
        return response.data;
      } catch (err: any) {
        // Log AFTER Python responds (failure)
        console.error(
          '[OUTBOUND CALL ❌ PYTHON ERROR]',
          err?.response?.data || err.message
        );
        // DO NOT silently catch - always throw after logging
        throw err;
      }
    } catch (error: any) {
      // Enhanced error logging for validation errors
      if (error.response?.status === 422) {
        console.error('[SIP Trunk Service] ❌ Validation error (422):', JSON.stringify(error.response?.data, null, 2));
        const validationErrors = error.response?.data?.detail || [];
        if (Array.isArray(validationErrors)) {
          validationErrors.forEach((err: any) => {
            console.error('[SIP Trunk Service] ❌ Missing field:', {
              location: err.loc,
              message: err.msg,
              type: err.type,
              input: err.input
            });
          });
        }
      }

      // Check if it's a 404 for agent or phone number not found
      if (error.response?.status === 404) {
        const detail = error.response?.data?.detail || error.response?.data?.message || '';

        if (detail.includes('agent') || detail.includes('agent_')) {
          console.error('[SIP Trunk Service] ❌ Agent ID not found in Python API:', data.agent_id);
          throw new AppError(
            404,
            'AGENT_NOT_FOUND_IN_API',
            `Agent ID ${data.agent_id} not found in Python API. Please ensure the agent exists and is synced.`
          );
        }

        if (detail.includes('phone_number') || detail.includes('phnum_') || detail.includes('Document with id phnum_')) {
          console.warn('[SIP Trunk Service] ⚠️ Phone number ID not found in Python API:', data.agent_phone_number_id);
          throw new AppError(
            404,
            'PHONE_NUMBER_NOT_FOUND_IN_API',
            `Phone number ID ${data.agent_phone_number_id} not found in Python API. The phone number may need to be re-registered.`
          );
        }

        // Generic 404 fallback
        console.error('[SIP Trunk Service] ❌ Resource not found (404):', detail);
        throw new AppError(404, 'RESOURCE_NOT_FOUND', detail || 'Voice service resource not found');
      }

      console.error('[SIP Trunk Service] ❌ Twilio outbound call failed:', error.response?.data || error.message);

      // Provide more detailed error message for validation errors
      let errorMessage = error.response?.data?.message || error.response?.data?.detail || 'Failed to initiate Twilio outbound call';
      if (error.response?.status === 422 && Array.isArray(error.response?.data?.detail)) {
        const missingFields = error.response.data.detail
          .map((err: any) => err.loc?.join('.') || 'unknown')
          .join(', ');
        errorMessage = `Validation failed. Missing or invalid fields: ${missingFields}`;
      }

      throw new AppError(
        error.response?.status || 500,
        'OUTBOUND_CALL_ERROR',
        errorMessage
      );
    }
  }

  /**
   * Initiate outbound call via SIP trunk
   * Calls Python /api/v1/sip-trunk/outbound-call endpoint
   */
  async outboundCall(data: InternalOutboundCallRequest): Promise<OutboundCallResponse> {
    try {
      const pythonUrl = `${COMM_API_URL}/api/v1/sip-trunk/outbound-call`;

      console.log('[SIP Trunk Service] ===== INITIATING SIP TRUNK OUTBOUND CALL =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);

      // Fetch e-commerce credentials if userId is provided
      let ecommerceCredentials = undefined;
      if (data.userId) {
        try {
          const { getEcommerceCredentials } = await import('../utils/ecommerce.util');
          ecommerceCredentials = await getEcommerceCredentials(data.userId);
          if (ecommerceCredentials) {
            console.log('[SIP Trunk Service] ✅ Found e-commerce credentials for user, attaching to payload');
          }
        } catch (err) {
          console.warn('[SIP Trunk Service] ⚠️ Failed to fetch e-commerce credentials:', err);
        }
      }

      // Build dynamic_variables by merging customer_info and explicit dynamic_variables
      const { buildDynamicVariables } = await import('../utils/dynamicVariables.util');
      const dynamicVariables = buildDynamicVariables(
        data.customer_info,
        data.dynamic_variables
      );

      // Log dynamic variables
      if (!data.dynamic_variables) {
        console.warn('[Dynamic Variables] Missing in request — injecting from customer_info');
      }
      console.log(
        '[Dynamic Variables] Final payload variables:',
        JSON.stringify(dynamicVariables, null, 2)
      );

      // Build payload matching ElevenLabs API schema (Strict)
      const body: OutboundCallRequest = {
        agent_id: data.agent_id,
        agent_phone_number_id: data.agent_phone_number_id,
        to_number: data.to_number,
        customer_info: {
          name: (data.customer_info?.name || "there").trim(),
          email: (data.customer_info?.email || "").trim()
        },
        dynamic_variables: dynamicVariables // ALWAYS include - never omit
      };

      // Add secure e-commerce credentials if valid
      if (ecommerceCredentials &&
        ecommerceCredentials.api_key &&
        ecommerceCredentials.api_secret &&
        ecommerceCredentials.base_url &&
        ecommerceCredentials.platform) {
        body.ecommerce_credentials = {
          api_key: ecommerceCredentials.api_key,
          api_secret: ecommerceCredentials.api_secret,
          base_url: ecommerceCredentials.base_url,
          platform: ecommerceCredentials.platform,
          access_token: ecommerceCredentials.access_token
        };
      }

      if (data.sender_email) {
        body.sender_email = data.sender_email;
      }

      console.log('[SIP Trunk Service] ✅ Final outbound payload constructed (Strict Schema)');

      console.log('[SIP Trunk Service] ✅ Final outbound payload constructed (Strict Schema)');

      // Log sensitive info redacted
      console.log(
        '[OUTBOUND CALL → PYTHON] Payload:',
        JSON.stringify({
          ...body,
          ecommerce_credentials: body.ecommerce_credentials ? { ...body.ecommerce_credentials, api_key: '***', api_secret: '***' } : undefined
        }, null, 2)
      );

      // Wrap in try/catch to log success OR failure
      try {
        const response = await axios.post<OutboundCallResponse>(
          pythonUrl,
          body,
          {
            timeout: 60000 // 60 seconds timeout
          }
        );

        // Log AFTER Python responds (success)
        console.log(
          '[OUTBOUND CALL ← PYTHON] Response:',
          JSON.stringify(response.data, null, 2)
        );

        console.log('[SIP Trunk Service] ✅ Outbound call initiated successfully');
        console.log('[SIP Trunk Service] Response status:', response.status);
        console.log('[SIP Trunk Service] Response body:');
        console.log(JSON.stringify(response.data, null, 2));

        return response.data;
      } catch (err: any) {
        // Log AFTER Python responds (failure)
        console.error(
          '[OUTBOUND CALL ❌ PYTHON ERROR]',
          err?.response?.data || err.message
        );
        // DO NOT silently catch - always throw after logging
        throw err;
      }
    } catch (error: any) {
      console.error('[SIP Trunk Service] ❌ Failed to initiate outbound call:', error.response?.data || error.message);

      // Enhanced error handling for 404 - phone number not found in Python API
      if (error.response?.status === 404) {
        const errorMessage = error.response?.data?.message || error.response?.data?.detail || 'Phone number not found in Python API';
        console.error('[SIP Trunk Service] Phone number not found in Python API database.');
        console.error('[SIP Trunk Service] This usually means the phone number needs to be registered with Python API first.');
        console.error('[SIP Trunk Service] Phone numbers created via Generic SIP Trunk are automatically synced.');
        console.error('[SIP Trunk Service] For other phone numbers, ensure they are registered with Python API.');

        throw new AppError(
          404,
          'OUTBOUND_CALL_ERROR',
          `Phone number ${data.agent_phone_number_id} not found in Python API. Please ensure the phone number is registered with Python API (e.g., via Generic SIP Trunk creation).`
        );
      }

      throw new AppError(
        error.response?.status || 500,
        'OUTBOUND_CALL_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to initiate outbound call'
      );
    }
  }
}

export const sipTrunkService = new SipTrunkService();

