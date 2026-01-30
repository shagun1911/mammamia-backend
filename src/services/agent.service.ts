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
  greeting_message?: string;
  language: string;
  voice_id?: string;
  escalationRules?: string[];
  knowledge_base_ids: string[];
  // tool_ids are now automatically added from env variables, not required in request
}

export interface CreateAgentResponse {
  agent_id: string;
}

export interface UpdateAgentPromptRequest {
  first_message: string;
  system_prompt: string;
  greeting_message?: string;
  language: string;
  voice_id?: string;
  escalationRules?: string[];
  knowledge_base_ids: string[];
  // tool_ids are automatically added from env variables, not required in request
}

export interface UpdateAgentPromptResponse {
  agent_id: string;
  name: string;
  conversation_config?: any;
  [key: string]: any;
}

export class AgentService {
  /**
   * Get all email template tool_ids for a user
   * These are automatically included in all agents
   */
  private async getEmailTemplateToolIds(userId: string): Promise<string[]> {
    try {
      const EmailTemplate = (await import('../models/EmailTemplate')).default;
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      const templates = await EmailTemplate.find({ userId: userObjectId })
        .select('tool_id')
        .lean();
      
      const toolIds = templates
        .map(t => (t as any).tool_id)
        .filter((id): id is string => !!id && typeof id === 'string');
      
      console.log(`[Agent Service] Found ${toolIds.length} email template tool_ids for user ${userId}`);
      return toolIds;
    } catch (error: any) {
      console.warn('[Agent Service] Failed to fetch email template tool_ids:', error.message);
      return []; // Return empty array on error to not block agent creation
    }
  }

  /**
   * Build complete tool_ids array including static env tools and email template tools
   */
  private async buildToolIds(userId: string): Promise<string[]> {
    // Get static tool IDs from environment variables
    const productsToolId = process.env.PRODUCTS_TOOL_ID;
    const ordersToolId = process.env.ORDERS_TOOL_ID;
    
    // Build tool_ids array from env variables (filter out undefined values)
    const toolIds: string[] = [];
    if (productsToolId) toolIds.push(productsToolId);
    if (ordersToolId) toolIds.push(ordersToolId);
    
    // Add email template tool_ids
    const emailTemplateToolIds = await this.getEmailTemplateToolIds(userId);
    toolIds.push(...emailTemplateToolIds);
    
    // Remove duplicates
    return [...new Set(toolIds)];
  }

  /**
   * Update agent tool_ids in Python API
   */
  private async updateAgentToolIdsInPython(agentId: string, toolIds: string[]): Promise<void> {
    try {
      const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/agents/${agentId}/prompt`;
      
      // Get the current agent to preserve other settings
      const agent = await Agent.findOne({ agent_id: agentId }).lean();
      
      if (!agent) {
        console.warn(`[Agent Service] Agent ${agentId} not found, skipping Python API update`);
        return;
      }
      
      const requestBody = {
        first_message: (agent as any).first_message || '',
        system_prompt: (agent as any).system_prompt || '',
        language: (agent as any).language || 'en',
        knowledge_base_ids: (agent as any).knowledge_base_ids || [],
        tool_ids: toolIds,
        ...((agent as any).voice_id && { voice_id: (agent as any).voice_id }),
        ...((agent as any).greeting_message && { greeting_message: (agent as any).greeting_message })
      };
      
      await axios.patch(pythonUrl, requestBody, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`[Agent Service] ✅ Updated agent ${agentId} tool_ids in Python API`);
    } catch (error: any) {
      console.error(`[Agent Service] ⚠️ Failed to update agent ${agentId} tool_ids in Python API:`, error.message);
      // Don't throw - this is a background update, shouldn't block the main operation
    }
  }

  /**
   * Create a new agent by calling external Python API
   * Then store the agent configuration in the database
   */
  async createAgent(userId: string, data: CreateAgentRequest): Promise<IAgent> {
    try {
      // Build complete tool_ids array (env tools + email template tools)
      const toolIds = await this.buildToolIds(userId);

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
      
      // Use greeting_message as first_message if provided, otherwise use first_message
      const firstMessageToSend = data.greeting_message || data.first_message;
      
      const requestBody = {
        name: data.name,
        first_message: firstMessageToSend,
        system_prompt: data.system_prompt,
        language: data.language,
        knowledge_base_ids: data.knowledge_base_ids,
        tool_ids: toolIds,
        ...(data.voice_id && { voice_id: data.voice_id }),
        ...(data.greeting_message && { greeting_message: data.greeting_message })
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
        greeting_message: data.greeting_message || '',
        language: data.language,
        voice_id: data.voice_id,
        escalationRules: data.escalationRules || [],
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
   * Update agent prompt by calling external Python API
   * Then update the agent configuration in the database
   */
  async updateAgentPrompt(agentId: string, userId: string, data: UpdateAgentPromptRequest): Promise<IAgent> {
    try {
      // Build complete tool_ids array (env tools + email template tools)
      const toolIds = await this.buildToolIds(userId);

      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      // First, verify the agent exists and belongs to the user
      const agent = await Agent.findOne({ 
        agent_id: agentId,
        userId: userObjectId 
      });

      if (!agent) {
        throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found');
      }

      console.log(`[Agent Service] Updating agent prompt for agent_id: ${agentId}, userId: ${userId}`);
      console.log(`[Agent Service] Update data:`, {
        language: data.language,
        knowledge_base_ids_count: data.knowledge_base_ids.length,
        tool_ids_count: toolIds.length,
        tool_ids: toolIds
      });

      // Call external Python API to update agent prompt
      const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/agents/${agentId}/prompt`;
      
      console.log(`[Agent Service] Calling Python API: ${pythonUrl}`);
      
      // Use greeting_message as first_message if provided, otherwise use first_message
      const firstMessageToSend = data.greeting_message || data.first_message;
      
      const requestBody = {
        first_message: firstMessageToSend,
        system_prompt: data.system_prompt,
        language: data.language,
        knowledge_base_ids: data.knowledge_base_ids,
        tool_ids: toolIds, // Static tool IDs from env
        ...(data.voice_id && { voice_id: data.voice_id }),
        ...(data.greeting_message && { greeting_message: data.greeting_message })
      };

      console.log(`[Agent Service] Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await axios.patch<UpdateAgentPromptResponse>(
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

      // Update agent configuration in database
      agent.first_message = data.first_message;
      agent.system_prompt = data.system_prompt;
      agent.language = data.language;
      agent.knowledge_base_ids = data.knowledge_base_ids;
      agent.tool_ids = toolIds; // Update with static tool IDs from env
      if (data.voice_id !== undefined) {
        agent.voice_id = data.voice_id;
      }
      if (data.greeting_message !== undefined) {
        agent.greeting_message = data.greeting_message;
      }
      if (data.escalationRules !== undefined) {
        agent.escalationRules = data.escalationRules;
      }
      await agent.save();

      console.log(`[Agent Service] Agent prompt updated successfully for agent_id: ${agentId}`);
      return agent;
    } catch (error: any) {
      console.error('[Agent Service] Failed to update agent prompt:', error);
      
      if (error instanceof AppError) {
        throw error;
      }
      
      if (error.response) {
        console.error('[Agent Service] Python API error response:', {
          status: error.response.status,
          data: error.response.data
        });
        throw new AppError(
          error.response.status || 500,
          'AGENT_UPDATE_ERROR',
          error.response.data?.detail || error.response.data?.message || 'Failed to update agent prompt in Python API'
        );
      }
      
      throw new AppError(
        500,
        'AGENT_UPDATE_ERROR',
        error.message || 'Failed to update agent prompt'
      );
    }
  }

  /**
   * Delete an agent by calling external Python API first, then deleting from database
   */
  async deleteAgent(agentId: string, userId: string): Promise<void> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      // First, find the agent to get the Python API agent_id
      const agent = await Agent.findOne({ 
        _id: agentId,
        userId: userObjectId 
      });

      if (!agent) {
        throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found');
      }

      const pythonAgentId = agent.agent_id;

      console.log(`[Agent Service] Deleting agent: MongoDB _id=${agentId}, Python agent_id=${pythonAgentId}`);

      // Call external Python API to delete the agent
      const pythonUrl = `${PYTHON_API_BASE_URL}/api/v1/agents/${pythonAgentId}`;
      
      console.log(`[Agent Service] Calling Python API to delete agent: ${pythonUrl}`);

      try {
        const response = await axios.delete(pythonUrl, {
          timeout: 30000, // 30 seconds timeout
          headers: {
            'Content-Type': 'application/json'
          }
        });

        console.log(`[Agent Service] Python API delete response:`, response.data);
      } catch (pythonError: any) {
        // Log the error but continue with database deletion
        // This allows cleanup even if Python API fails
        console.error('[Agent Service] Python API delete failed (continuing with DB deletion):', {
          status: pythonError.response?.status,
          data: pythonError.response?.data,
          message: pythonError.message
        });
        
        // If it's a 404, the agent might already be deleted from Python API, which is fine
        if (pythonError.response?.status !== 404) {
          // For other errors, we might want to still proceed or throw
          // For now, we'll proceed with database deletion to allow cleanup
          console.warn('[Agent Service] Python API delete failed, but proceeding with database cleanup');
        }
      }
      
      // Delete from our database
      await Agent.deleteOne({ _id: agentId, userId: userObjectId });
      console.log(`[Agent Service] Agent deleted from database: ${agentId}`);
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error('[Agent Service] Failed to delete agent:', error);
      throw new AppError(500, 'AGENT_DELETE_ERROR', 'Failed to delete agent');
    }
  }

  /**
   * Add email template tool_id to all existing agents for a user
   * This is called when a new email template is created
   */
  async addEmailTemplateToolIdToAllAgents(userId: string, toolId: string): Promise<void> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      // Find all agents for this user
      const agents = await Agent.find({ userId: userObjectId });
      
      console.log(`[Agent Service] Adding tool_id ${toolId} to ${agents.length} agents for user ${userId}`);
      
      // Update each agent
      for (const agent of agents) {
        // Check if tool_id already exists
        if (agent.tool_ids.includes(toolId)) {
          console.log(`[Agent Service] Agent ${agent.agent_id} already has tool_id ${toolId}, skipping`);
          continue;
        }
        
        // Add tool_id to the array
        agent.tool_ids.push(toolId);
        await agent.save();
        
        // Update in Python API
        await this.updateAgentToolIdsInPython(agent.agent_id, agent.tool_ids);
        
        console.log(`[Agent Service] ✅ Added tool_id ${toolId} to agent ${agent.agent_id}`);
      }
      
      console.log(`[Agent Service] ✅ Successfully added tool_id ${toolId} to all agents for user ${userId}`);
    } catch (error: any) {
      console.error('[Agent Service] Failed to add email template tool_id to agents:', error);
      // Don't throw - this is a background operation
    }
  }

  /**
   * Remove email template tool_id from all existing agents for a user
   * This is called when an email template is deleted
   */
  async removeEmailTemplateToolIdFromAllAgents(userId: string, toolId: string): Promise<void> {
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      // Find all agents for this user
      const agents = await Agent.find({ userId: userObjectId });
      
      console.log(`[Agent Service] Removing tool_id ${toolId} from ${agents.length} agents for user ${userId}`);
      
      // Update each agent
      for (const agent of agents) {
        // Check if tool_id exists
        if (!agent.tool_ids.includes(toolId)) {
          console.log(`[Agent Service] Agent ${agent.agent_id} doesn't have tool_id ${toolId}, skipping`);
          continue;
        }
        
        // Remove tool_id from the array
        agent.tool_ids = agent.tool_ids.filter(id => id !== toolId);
        await agent.save();
        
        // Update in Python API
        await this.updateAgentToolIdsInPython(agent.agent_id, agent.tool_ids);
        
        console.log(`[Agent Service] ✅ Removed tool_id ${toolId} from agent ${agent.agent_id}`);
      }
      
      console.log(`[Agent Service] ✅ Successfully removed tool_id ${toolId} from all agents for user ${userId}`);
    } catch (error: any) {
      console.error('[Agent Service] Failed to remove email template tool_id from agents:', error);
      // Don't throw - this is a background operation
    }
  }
}

export const agentService = new AgentService();

