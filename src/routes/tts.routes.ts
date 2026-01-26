import { Router } from 'express';
import { ttsController } from '../controllers/tts.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post("/generate-audio", ttsController.generateAudio);

export default router;
