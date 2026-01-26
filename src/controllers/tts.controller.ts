import { Request, Response, NextFunction } from "express";
import { ttsService } from "../services/tts.service";

export const ttsController = {
  async generateAudio(req: Request, res: Response, _next: NextFunction) {
    console.log("🔥 /api/v1/tts/generate-audio HIT");

    const { voiceId, text } = req.body;

    // ✅ Input validation
    if (!voiceId || !text) {
      return res.status(400).json({
        success: false,
        error: "voiceId and text are required",
      });
    }

    try {
      // ✅ Call service (ElevenLabs logic is NOT here)
      const audioBuffer = await ttsService.generateAudio(voiceId, text);

      console.log(
        "✅ TTS success. Audio size:",
        audioBuffer.byteLength,
        "bytes"
      );

      // ✅ Proper audio response
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.byteLength);

      return res.status(200).send(audioBuffer);
    } catch (error: any) {
      console.error("❌ TTS Controller Error:", error);

      // ❗ Never return 200 on failure
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.code || "TTS_FAILED",
        message: error.message || "Failed to generate audio",
      });
    }
  },
};
