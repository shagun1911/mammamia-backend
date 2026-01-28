import { Router } from 'express';
import { agentController } from '../controllers/agent.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

// Agent routes
router.post('/', agentController.createAgent);
router.get('/', agentController.getAgents);
router.get('/:id', agentController.getAgentById);
router.delete('/:id', agentController.deleteAgent);

export default router;

