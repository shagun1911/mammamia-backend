import axios from 'axios';
import { AppError } from '../middleware/error.middleware';
import Agent, { IAgent } from '../models/Agent';
import mongoose from 'mongoose';

// Python API base URL - should match the one used for agents endpoint
const PYTHON_API_BASE_URL = process.env.PYTHON_API_URL || 'https://elvenlabs-voiceagent.onrender.com';

export interface CreateAgentRequest {
  name: string;
  first_message: string;
  system_prompt: string;
  language: string;
  voice_id?: string;
  knowledge_base_ids: string[];
  // tool_ids are now automatically added from env variables, not required in request
}

export interface CreateAgentResponse {
  agent_id: string;
}

export class AgentService {
  /**
   * Create a new agent by calling external Python API
   * Then store the agent configuration in the database
   */
  async createAgent(userId: string, data: CreateAgentRequest): Promise<IAgent> {
    try {
      // Get static tool IDs from environment variables
      const productsToolId = process.env.PRODUCTS_TOOL_ID;
      const ordersToolId = process.env.ORDERS_TOOL_ID;
      
      // Build tool_ids array from env variables (filter out undefined values)
      const toolIds: string[] = [];
      if (productsToolId) toolIds.push(productsToolId);
      if (ordersToolId) toolIds.push(ordersToolId);

      console.log(`[Agent Service] Creating agent for userId: ${userId}`);
      console.log(`[Agent Service] Agent data:`, {
        name: data.name,
        language: data.language,
        knowledge_base_ids_count: data.knowledge_base_ids.length,
        tool_ids_count: toolIds.length,
        tool_ids: toolIds
      });

      // Call external Python API to create agent
      const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/agents`;
      
      console.log(`[Agent Service] Calling Python API: ${pythonUrl}`);
      
      const requestBody = {
        name: data.name,
        first_message: data.first_message,
        system_prompt: data.system_prompt,
        language: data.language,
        knowledge_base_ids: data.knowledge_base_ids,
        tool_ids: toolIds,
        ...(data.voice_id && { voice_id: data.voice_id })
      };

      console.log(`[Agent Service] Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await axios.post<CreateAgentResponse>(
        pythonUrl,
        requestBody,
        {
          timeout: 30000, // 30 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Agent Service] Python API response:`, response.data);

      if (!response.data.agent_id) {
        throw new AppError(500, 'INVALID_RESPONSE', 'Python API did not return agent_id');
      }

      // Convert userId string to ObjectId
      const userObjectId = new mongoose.Types.ObjectId(userId);

      // Store agent configuration in database
      const agent = await Agent.create({
        userId: userObjectId,
        agent_id: response.data.agent_id,
        name: data.name,
        first_message: data.first_message,
        system_prompt: data.system_prompt,
        language: data.language,
        voice_id: data.voice_id,
        knowledge_base_ids: data.knowledge_base_ids,
        tool_ids: toolIds // Use the static tool IDs from env
      });

      console.log(`[Agent Service] Agent created successfully with ID: ${agent.agent_id}`);
      return agent;
    } catch (error: any) {
      console.error('[Agent Service] Failed to create agent:', error);
      
      if (error.response) {
        console.error('[Agent Service] Python API error response:', {
          status: error.response.status,
          data: error.response.data
        });
        throw new AppError(
          error.response.status || 500,
          'AGENT_CREATION_ERROR',
          error.response.data?.detail || error.response.data?.message || 'Failed to create agent in Python API'
        );
      }
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(
        500,
        'AGENT_CREATION_ERROR',
        error.message || 'Failed to create agent'
      );
    }
  }

  /**
   * Get all agents for a user
   */
  async getAgentsByUserId(userId: string): Promise<IAgent[]> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const agents = await Agent.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .lean();
      
      return agents as unknown as IAgent[];
    } catch (error: any) {
      console.error('[Agent Service] Failed to get agents:', error);
      throw new AppError(500, 'AGENT_FETCH_ERROR', 'Failed to fetch agents');
    }
  }

  /**
   * Get a single agent by ID
   */
  async getAgentById(agentId: string, userId: string): Promise<IAgent | null> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const agent = await Agent.findOne({ 
        _id: agentId,
        userId: userObjectId 
      }).lean();
      
      return agent as unknown as IAgent | null;
    } catch (error: any) {
      console.error('[Agent Service] Failed to get agent:', error);
      throw new AppError(500, 'AGENT_FETCH_ERROR', 'Failed to fetch agent');
    }
  }

  /**
   * Get agent by agent_id (from Python API)
   */
  async getAgentByAgentId(agentId: string, userId: string): Promise<IAgent | null> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const agent = await Agent.findOne({ 
        agent_id: agentId,
        userId: userObjectId 
      }).lean();
      
      return agent as unknown as IAgent | null;
    } catch (error: any) {
      console.error('[Agent Service] Failed to get agent by agent_id:', error);
      throw new AppError(500, 'AGENT_FETCH_ERROR', 'Failed to fetch agent');
    }
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string, userId: string): Promise<void> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const agent = await Agent.findOne({ 
        _id: agentId,
        userId: userObjectId 
      });

      if (!agent) {
        throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found');
      }

      // TODO: Optionally call Python API to delete the agent there too
      // For now, just delete from our database
      
      await Agent.deleteOne({ _id: agentId, userId: userObjectId });
      console.log(`[Agent Service] Agent deleted: ${agentId}`);
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error('[Agent Service] Failed to delete agent:', error);
      throw new AppError(500, 'AGENT_DELETE_ERROR', 'Failed to delete agent');
    }
  }
}

export const agentService = new AgentService();

