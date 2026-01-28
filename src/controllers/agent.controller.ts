import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { agentService } from '../services/agent.service';
import { successResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

export class AgentController {
  /**
   * POST /api/v1/agents
   * Create a new agent
   */
  createAgent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const {
        name,
        first_message,
        system_prompt,
        language,
        voice_id,
        knowledge_base_ids
      } = req.body;

      // Validation
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Agent name is required');
      }

      if (!first_message || typeof first_message !== 'string' || first_message.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'First message is required');
      }

      if (!system_prompt || typeof system_prompt !== 'string' || system_prompt.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'System prompt is required');
      }

      if (!language || typeof language !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Language is required');
      }

      if (!Array.isArray(knowledge_base_ids)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'knowledge_base_ids must be an array');
      }

      // tool_ids are now automatically added from env variables (PRODUCTS_TOOL_ID and ORDERS_TOOL_ID)
      const agent = await agentService.createAgent(userId, {
        name: name.trim(),
        first_message: first_message.trim(),
        system_prompt: system_prompt.trim(),
        language: language.trim(),
        voice_id: voice_id?.trim(),
        knowledge_base_ids: knowledge_base_ids
      });

      res.status(201).json(successResponse(agent, 'Agent created successfully'));
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/agents
   * Get all agents for the current user
   */
  getAgents = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const agents = await agentService.getAgentsByUserId(userId);
      res.json(successResponse(agents));
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/agents/:id
   * Get a single agent by ID
   */
  getAgentById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const agentId = req.params.id;
      
      const agent = await agentService.getAgentById(agentId, userId);
      
      if (!agent) {
        throw new AppError(404, 'NOT_FOUND', 'Agent not found');
      }

      res.json(successResponse(agent));
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/agents/:id
   * Delete an agent
   */
  deleteAgent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const agentId = req.params.id;
      
      await agentService.deleteAgent(agentId, userId);
      
      res.json(successResponse(null, 'Agent deleted successfully'));
    } catch (error) {
      next(error);
    }
  };
}

export const agentController = new AgentController();

