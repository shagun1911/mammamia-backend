import { Request, Response } from "express";
import axios from "axios";

export const ttsController = {
  async generateAudio(req: Request, res: Response) {
    console.log("🔥 /tts/generate-audio HIT");

    const { voiceId, text } = req.body;

    if (!voiceId || !text) {
      return res.status(400).json({ error: "voiceId and text required" });
    }

    try {
      const response = await axios.post(
        `https://api.eu.residency.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text, model_id: "eleven_multilingual_v2" },
        {
          headers: {
            "xi-api-key": process.env.ELEVEN_API_KEY!,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
        }
      );

      console.log("✅ ElevenLabs API responded. Audio data size:", response.data.byteLength, "bytes");
      console.log("Content-Type from ElevenLabs (if available):", response.headers['content-type']);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", response.data.byteLength); // Use byteLength for ArrayBuffer
      return res.status(200).send(response.data);
    } catch (err: any) {
      console.error("ElevenLabs error:", err.response?.data ? new TextDecoder().decode(err.response.data) : err.message);
      // IMPORTANT: return NON-200 so frontend doesn't try to play it
      return res.status(500).send("TTS_FAILED");
    }
  },
};
