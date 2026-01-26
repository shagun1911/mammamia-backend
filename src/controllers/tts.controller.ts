import { Request, Response } from "express";
import { ttsService } from "../services/tts.service";

export const ttsController = {
  async generateAudio(req: Request, res: Response) {
    console.log("🔥 /tts/generate-audio HIT");

    const { voiceId, text } = req.body;

    if (!voiceId || !text) {
      return res.status(400).json({ error: "voiceId and text required" });
    }

    try {
      const audioBuffer = await ttsService.generateAudio(voiceId, text);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.byteLength); // Use byteLength for ArrayBuffer

      return res.status(200).send(audioBuffer);
    } catch (err: any) {
      console.error("❌ TTS Controller error:", err.message); // Log the error message from the service
      return res.status(err.statusCode || 500).json({
        code: err.code || "TTS_FAILED",
        message: err.message, // Propagate the service-level error message
      });
    }
  },
};
