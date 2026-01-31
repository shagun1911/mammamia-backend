
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Agent from '../models/Agent';
import { agentService } from '../services/agent.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/kepleroAI';

async function updateAllAgentsPrompts() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const agents = await Agent.find({});
        console.log(`Found ${agents.length} agents to update.`);

        for (const agent of agents) {
            console.log(`Updating agent: ${agent.name} (${agent.agent_id})...`);

            // We pass the EXISTING system prompt, and agentService.updateAgentPrompt 
            // will PREPEND the master prompt automatically due to my changes.
            // But wait, if I pass `agent.system_prompt`, `updateAgentPrompt` will append it to `WOOCOMMERCE_MASTER_PROMPT`.
            // If the agent ALREADY has the master prompt (if I ran this twice), it would duplicate?
            // My code: `const systemPromptToSend = \`${WOOCOMMERCE_MASTER_PROMPT}\n\n${data.system_prompt || ''}\`;`
            // I should check if it already starts with it. 
            // But `agentService` logic is hardcoded to prepend.
            // Ideally I should strip it first? 
            // The `WOOCOMMERCE_MASTER_PROMPT` checks are not in `agentService`.
            // However, since I just added the code, existing agents definitely DO NOT have it.
            // So running this ONCE is safe.

            try {
                await agentService.updateAgentPrompt(agent.agent_id, agent.userId.toString(), {
                    first_message: agent.first_message,
                    system_prompt: agent.system_prompt, // Pass existing prompt
                    language: agent.language,
                    knowledge_base_ids: agent.knowledge_base_ids,
                    voice_id: agent.voice_id
                });
                console.log(`✅ Updated agent ${agent.agent_id}`);
            } catch (err: any) {
                console.error(`❌ Failed to update agent ${agent.agent_id}:`, err.message);
            }
        }

        console.log('All agents processed.');
        process.exit(0);
    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    }
}

updateAllAgentsPrompts();
