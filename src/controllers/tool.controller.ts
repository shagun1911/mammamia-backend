import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { toolService } from '../services/tool.service';
import { AppError } from '../middleware/error.middleware';

export class ToolController {
  /**
   * Get all tools for authenticated user
   * GET /api/v1/tools
   */
  async getAll(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const tools = await toolService.getAll(userId);
      
      res.json({
        success: true,
        tools: tools.map(tool => ({
          tool_id: tool.tool_id,
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          description: tool.description,
          properties: tool.properties,
          created_at: tool.createdAt,
          updated_at: tool.updatedAt,
        })),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get a tool by ID
   * GET /api/v1/tools/:toolId
   */
  async getById(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      const { toolId } = req.params;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const tool = await toolService.getById(toolId, userId);
      
      res.json({
        success: true,
        tool: {
          tool_id: tool.tool_id,
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          description: tool.description,
          properties: tool.properties,
          created_at: tool.createdAt,
          updated_at: tool.updatedAt,
        },
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Register a new tool or update existing
   * POST /api/v1/tools/register
   */
  async register(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const { tool_name, tool_type, description, properties } = req.body;

      // Validation
      if (!tool_name || !tool_type || !description) {
        throw new AppError(400, 'VALIDATION_ERROR', 'tool_name, tool_type, and description are required');
      }

      if (!Array.isArray(properties)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'properties must be an array');
      }

      const tool = await toolService.register(userId, {
        tool_name,
        tool_type,
        description,
        properties,
      });

      res.json({
        status: 'success',
        message: tool.createdAt.getTime() === tool.updatedAt.getTime() 
          ? 'Tool registered successfully' 
          : 'Tool updated successfully',
        tool_id: tool.tool_id,
        tool: {
          tool_id: tool.tool_id,
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          description: tool.description,
          properties: tool.properties,
          created_at: tool.createdAt,
          updated_at: tool.updatedAt,
        },
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update a tool
   * PUT /api/v1/tools/:toolId
   */
  async update(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      const { toolId } = req.params;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const { tool_name, tool_type, description, properties } = req.body;

      // Validation
      if (!tool_name || !tool_type || !description) {
        throw new AppError(400, 'VALIDATION_ERROR', 'tool_name, tool_type, and description are required');
      }

      if (!Array.isArray(properties)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'properties must be an array');
      }

      const tool = await toolService.update(toolId, userId, {
        tool_name,
        tool_type,
        description,
        properties,
      });

      res.json({
        status: 'success',
        message: 'Tool updated successfully',
        tool_id: tool.tool_id,
        tool: {
          tool_id: tool.tool_id,
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          description: tool.description,
          properties: tool.properties,
          created_at: tool.createdAt,
          updated_at: tool.updatedAt,
        },
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a tool
   * POST /api/v1/tools/delete
   */
  async delete(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const { tool_id } = req.body;

      if (!tool_id) {
        throw new AppError(400, 'VALIDATION_ERROR', 'tool_id is required');
      }

      await toolService.delete(tool_id, userId);

      res.json({
        status: 'success',
        message: 'Tool deleted successfully',
        tool_id,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get tools by type
   * GET /api/v1/tools/type/:toolType
   */
  async getByType(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?._id;
      const { toolType } = req.params;
      
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const tools = await toolService.getByType(userId, toolType);
      
      res.json({
        success: true,
        tools: tools.map(tool => ({
          tool_id: tool.tool_id,
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          description: tool.description,
          properties: tool.properties,
          created_at: tool.createdAt,
          updated_at: tool.updatedAt,
        })),
      });
    } catch (error) {
      throw error;
    }
  }
}

export const toolController = new ToolController();

