import Prompt from '../models/Prompt';
import { AppError } from '../middleware/error.middleware';

export class PromptService {
  async getCurrentPrompt(type: 'chatbot' | 'voice') {
    const prompt = await Prompt.findOne({ type }).sort({ version: -1 }).lean();

    if (!prompt) {
      // Create default prompt if none exists
      const defaultPrompt = await this.createDefaultPrompt(type);
      return defaultPrompt;
    }

    // Get previous versions
    const previousVersions = await Prompt.find({ type, version: { $lt: prompt.version } })
      .sort({ version: -1 })
      .limit(5)
      .lean();

    return {
      ...prompt,
      previousVersions
    };
  }

  async updatePrompt(type: 'chatbot' | 'voice', userInstructions: string) {
    const currentPrompt = await Prompt.findOne({ type }).sort({ version: -1 });

    const newVersion = currentPrompt ? currentPrompt.version + 1 : 1;

    // Generate system prompt based on user instructions
    const systemPrompt = this.generateSystemPrompt(type, userInstructions);

    const newPrompt = await Prompt.create({
      type,
      userInstructions,
      systemPrompt,
      version: newVersion
    });

    return newPrompt;
  }

  async revertToVersion(type: 'chatbot' | 'voice', version: number) {
    const oldPrompt = await Prompt.findOne({ type, version });

    if (!oldPrompt) {
      throw new AppError(404, 'NOT_FOUND', 'Prompt version not found');
    }

    const currentPrompt = await Prompt.findOne({ type }).sort({ version: -1 });
    const newVersion = currentPrompt ? currentPrompt.version + 1 : 1;

    const newPrompt = await Prompt.create({
      type,
      userInstructions: oldPrompt.userInstructions,
      systemPrompt: oldPrompt.systemPrompt,
      version: newVersion
    });

    return newPrompt;
  }

  private generateSystemPrompt(type: string, userInstructions: string): string {
    const basePrompt = type === 'chatbot'
      ? 'You are a helpful customer support AI assistant. Your role is to assist customers with their questions and issues.'
      : 'You are a voice AI assistant for customer support calls. Speak naturally and be concise.';

    return `${basePrompt}\n\nAdditional Instructions:\n${userInstructions}\n\nAlways be professional, helpful, and use the knowledge base provided to answer questions accurately.`;
  }

  private async createDefaultPrompt(type: 'chatbot' | 'voice') {
    const defaultInstructions = type === 'chatbot'
      ? 'Be friendly and helpful. Always ask for order numbers when helping with order-related issues.'
      : 'Be concise and natural. Keep responses short for voice conversations.';

    return await this.updatePrompt(type, defaultInstructions);
  }
}

export const promptService = new PromptService();

