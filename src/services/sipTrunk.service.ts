import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

const COMM_API_URL = process.env.COMM_API_URL || 'https://keplerov1-python-2.onrender.com';

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
      const pythonUrl = `${COMM_API_URL}/calls/create-generic-sip-trunk`;
      
      console.log('[SIP Trunk Service] ===== CREATING GENERIC SIP TRUNK =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);
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
      
      const response = await axios.post<CreateGenericSipTrunkResponse>(
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

      console.log('[SIP Trunk Service] ✅ Generic SIP trunk created successfully');
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
    } catch (error: any) {
      console.error('[SIP Trunk] ❌ Failed to create Generic SIP trunk:', error.response?.data || error.message);
      throw new AppError(
        error.response?.status || 500,
        'GENERIC_SIP_TRUNK_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to create Generic SIP trunk'
      );
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
      // Build URL with query parameters (not body!)
      const pythonUrl = `${COMM_API_URL}/calls/create-dispatch-rule?sip_trunk_id=${encodeURIComponent(data.sip_trunk_id)}&name=${encodeURIComponent(data.name)}&agent_name=${encodeURIComponent(data.agent_name)}`;
      
      console.log('[SIP Trunk Service] ===== CREATING DISPATCH RULE =====');
      console.log('[SIP Trunk Service] Python API URL:', pythonUrl);
      console.log('[SIP Trunk Service] Query params:', {
        sip_trunk_id: data.sip_trunk_id,
        name: data.name,
        agent_name: data.agent_name
      });
      
      const response = await axios.post<CreateDispatchRuleResponse>(
        pythonUrl,
        {}, // Empty body - all params in URL
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
      
      // Log detailed validation errors
      if (error.response?.data?.detail && Array.isArray(error.response.data.detail)) {
        console.error('[SIP Trunk] ❌ VALIDATION ERRORS - Missing fields:');
        error.response.data.detail.forEach((err: any, index: number) => {
          console.error(`  ${index + 1}. Field: ${err.loc?.join(' -> ') || 'unknown'}`);
          console.error(`     Type: ${err.type}`);
          console.error(`     Message: ${err.msg}`);
          console.error(`     Input: ${JSON.stringify(err.input)}`);
        });
      }
      
      throw new AppError(
        error.response?.status || 500,
        'DISPATCH_RULE_ERROR',
        error.response?.data?.message || error.response?.data?.detail || 'Failed to create dispatch rule'
      );
    }
  }
}

export const sipTrunkService = new SipTrunkService();

