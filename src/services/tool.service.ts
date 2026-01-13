import Tool, { ITool, IToolProperty } from '../models/Tool';
import { AppError } from '../middleware/error.middleware';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

interface RegisterToolData {
  tool_name: string;
  tool_type: string;
  description: string;
  properties: IToolProperty[];
}

export class ToolService {
  /**
   * Get all tools for a user
   */
  async getAll(userId: string): Promise<ITool[]> {
    try {
      const tools = await Tool.find({ userId }).sort({ createdAt: -1 });
      return tools;
    } catch (error) {
      console.error('[Tool Service] Error fetching tools:', error);
      throw new AppError(500, 'TOOL_FETCH_ERROR', 'Failed to fetch tools');
    }
  }

  /**
   * Get a tool by ID
   */
  async getById(toolId: string, userId: string): Promise<ITool> {
    try {
      const tool = await Tool.findOne({ tool_id: toolId, userId });
      
      if (!tool) {
        throw new AppError(404, 'TOOL_NOT_FOUND', 'Tool not found');
      }

      return tool;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[Tool Service] Error fetching tool:', error);
      throw new AppError(500, 'TOOL_FETCH_ERROR', 'Failed to fetch tool');
    }
  }

  /**
   * Register a new tool or update existing one
   */
  async register(userId: string, data: RegisterToolData): Promise<ITool> {
    try {
      // Check if tool with same name exists for this user
      const existingTool = await Tool.findOne({
        userId,
        tool_name: data.tool_name,
      });

      if (existingTool) {
        // Update existing tool
        existingTool.tool_type = data.tool_type;
        existingTool.description = data.description;
        existingTool.properties = data.properties;
        await existingTool.save();
        
        console.log(`[Tool Service] Updated tool: ${data.tool_name}`);
        return existingTool;
      }

      // Create new tool
      const tool = await Tool.create({
        userId,
        tool_id: uuidv4(),
        tool_name: data.tool_name,
        tool_type: data.tool_type,
        description: data.description,
        properties: data.properties,
      });

      console.log(`[Tool Service] Created new tool: ${data.tool_name}`);
      return tool;
    } catch (error: any) {
      console.error('[Tool Service] Error registering tool:', error);
      
      if (error.code === 11000) {
        throw new AppError(400, 'TOOL_EXISTS', 'A tool with this name already exists');
      }
      
      throw new AppError(500, 'TOOL_REGISTER_ERROR', 'Failed to register tool');
    }
  }

  /**
   * Update an existing tool
   */
  async update(toolId: string, userId: string, data: RegisterToolData): Promise<ITool> {
    try {
      const tool = await Tool.findOne({ tool_id: toolId, userId });
      
      if (!tool) {
        throw new AppError(404, 'TOOL_NOT_FOUND', 'Tool not found');
      }

      // Update fields
      tool.tool_name = data.tool_name;
      tool.tool_type = data.tool_type;
      tool.description = data.description;
      tool.properties = data.properties;
      
      await tool.save();
      
      console.log(`[Tool Service] Updated tool: ${toolId}`);
      return tool;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[Tool Service] Error updating tool:', error);
      throw new AppError(500, 'TOOL_UPDATE_ERROR', 'Failed to update tool');
    }
  }

  /**
   * Delete a tool
   */
  async delete(toolId: string, userId: string): Promise<void> {
    try {
      const result = await Tool.findOneAndDelete({ tool_id: toolId, userId });
      
      if (!result) {
        throw new AppError(404, 'TOOL_NOT_FOUND', 'Tool not found');
      }

      console.log(`[Tool Service] Deleted tool: ${toolId}`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[Tool Service] Error deleting tool:', error);
      throw new AppError(500, 'TOOL_DELETE_ERROR', 'Failed to delete tool');
    }
  }

  /**
   * Get tools by type
   */
  async getByType(userId: string, toolType: string): Promise<ITool[]> {
    try {
      const tools = await Tool.find({ userId, tool_type: toolType }).sort({ createdAt: -1 });
      return tools;
    } catch (error) {
      console.error('[Tool Service] Error fetching tools by type:', error);
      throw new AppError(500, 'TOOL_FETCH_ERROR', 'Failed to fetch tools');
    }
  }
}

export const toolService = new ToolService();

