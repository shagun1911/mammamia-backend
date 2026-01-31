import Agent from '../models/Agent';
import { normalizeTemplateVariables } from './normalizeTemplateVariables.util';

/**
 * One-time migration to normalize all existing agent template variables to lowercase
 * This should be called once on server startup after database connection
 */
export async function normalizeAllAgentTemplates(): Promise<void> {
  try {
    console.log('[Agent Migration] Starting normalization of template variables...');
    
    const agents = await Agent.find({});
    let updatedCount = 0;
    let totalAgents = agents.length;

    for (const agent of agents) {
      let changed = false;

      // Normalize first_message
      if (agent.first_message) {
        const result = normalizeTemplateVariables(agent.first_message);
        if (result.changed) {
          agent.first_message = result.normalized;
          changed = true;
        }
      }

      // Normalize greeting_message (if present)
      if (agent.greeting_message) {
        const result = normalizeTemplateVariables(agent.greeting_message);
        if (result.changed) {
          agent.greeting_message = result.normalized;
          changed = true;
        }
      }

      // Normalize system_prompt
      if (agent.system_prompt) {
        const result = normalizeTemplateVariables(agent.system_prompt);
        if (result.changed) {
          agent.system_prompt = result.normalized;
          changed = true;
        }
      }

      // Save if any changes were made
      if (changed) {
        await agent.save();
        updatedCount++;
        console.log(`[Agent Migration] ✅ Updated agent ${agent.agent_id} (${agent.name})`);
      }
    }

    console.log(`[Agent Migration] ✅ Completed: ${updatedCount}/${totalAgents} agents updated`);
  } catch (error: any) {
    console.error('[Agent Migration] ❌ Error normalizing agent templates:', error.message);
    // Don't throw - migration failure shouldn't block server startup
  }
}

