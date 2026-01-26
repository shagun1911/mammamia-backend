import axios from "axios";
import { AppError } from "../middleware/error.middleware";

const ELEVENLABS_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVENLABS_API_URL =
  process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io/v1";

// 🔍 Log once at startup (helps catch Render misconfig)
console.log("🎤 ElevenLabs Config:", {
  ELEVENLABS_API_URL,
  hasKey: !!ELEVENLABS_API_KEY,
});

class TTSService {
  async generateAudio(voiceId: string, text: string): Promise<ArrayBuffer> {
    if (!ELEVENLABS_API_KEY) {
      throw new AppError(
        500,
        "ELEVENLABS_ERROR",
        "ElevenLabs API key is not configured"
      );
    }

    try {
      const response = await axios.post(
        `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
        {
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        },
        {
          headers: {
            Accept: "audio/mpeg",
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 15000,
        }
      );

      if (response.status !== 200 || !response.data) {
        throw new AppError(
          response.status,
          "ELEVENLABS_ERROR",
          "Invalid audio response from ElevenLabs"
        );
      }

      return response.data;
    } catch (error: any) {
      const errorMessage =
        error.response?.data
          ? error.response.data instanceof ArrayBuffer
            ? new TextDecoder().decode(error.response.data)
            : JSON.stringify(error.response.data)
          : error.message;

      console.error("❌ ElevenLabs TTS Error:", errorMessage);

      throw new AppError(
        error.response?.status || 500,
        "ELEVENLABS_ERROR",
        errorMessage || "Failed to generate audio"
      );
    }
  }
}

export const ttsService = new TTSService();
