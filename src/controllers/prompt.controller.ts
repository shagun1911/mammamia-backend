import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { PromptService } from '../services/prompt.service';
import { successResponse } from '../utils/response.util';

export class PromptController {
  private promptService: PromptService;

  constructor() {
    this.promptService = new PromptService();
  }

  getCurrentPrompt = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { type } = req.params;
      const prompt = await this.promptService.getCurrentPrompt(type as 'chatbot' | 'voice');
      res.json(successResponse(prompt));
    } catch (error) {
      next(error);
    }
  };

  updatePrompt = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { type } = req.params;
      const { userInstructions } = req.body;
      const prompt = await this.promptService.updatePrompt(
        type as 'chatbot' | 'voice',
        userInstructions
      );
      res.json(successResponse(prompt, 'Prompt updated'));
    } catch (error) {
      next(error);
    }
  };

  revertPrompt = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { type } = req.params;
      const { version } = req.body;
      const prompt = await this.promptService.revertToVersion(
        type as 'chatbot' | 'voice',
        version
      );
      res.json(successResponse(prompt, 'Prompt reverted'));
    } catch (error) {
      next(error);
    }
  };
}

export const promptController = new PromptController();

