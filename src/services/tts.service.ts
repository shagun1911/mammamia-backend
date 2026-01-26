import axios from 'axios';
import { AppError } from '../middleware/error.middleware';

const ELEVENLABS_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVEN_API_URL || 'https://api.elevenlabs.io/v1';

class TTSService {
  async generateAudio(voiceId: string, text: string): Promise<ArrayBuffer> {
    if (!ELEVENLABS_API_KEY) {
      throw new AppError(500, 'ELEVENLABS_ERROR', 'ElevenLabs API key is not configured.');
    }

    try {
      const response = await axios.post(
        `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: "eleven_multilingual_v2", 
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 15000, // 15 seconds timeout
        }
      );

      if (response.status === 200) {
        return response.data;
      } else {
        throw new AppError(response.status, 'ELEVENLABS_ERROR', `ElevenLabs API returned status: ${response.status}`);
      }
    } catch (error: any) {
      console.error('❌ ElevenLabs TTS error:', error.response?.data ? JSON.stringify(error.response.data.toString()) : error.message);
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to generate audio from ElevenLabs.';
      throw new AppError(error.response?.status || 500, 'ELEVENLABS_ERROR', errorMessage);
    }
  }
}

export const ttsService = new TTSService();
