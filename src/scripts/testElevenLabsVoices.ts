import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const VOICE_ID_MAP: Record<string, string> = {
  'roxy' : 'OUMCzFUTd0F4Q6lkLkco',	
'ginevra' : 'QITiGyM4owEZrBEf0QV8',
'allison' : 'xctasy8XvGp2cVO9HL9k',


};

const ELEVENLABS_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVEN_API_URL || 'https://api.elevenlabs.io/v1/text-to-speech';

async function testElevenLabsVoices() {
  if (!ELEVENLABS_API_KEY) {
    console.error('ELEVEN_API_KEY is not set. Please set the environment variable.');
    return;
  }

  const outputDir = path.join(__dirname, 'elevenlabs_test_outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  console.log('Starting ElevenLabs voice ID testing...');

  for (const [voiceName, voiceId] of Object.entries(VOICE_ID_MAP)) {
    console.log(`\nTesting voice: ${voiceName} (ID: ${voiceId})...`);
    try {
      const response = await axios.post(
        `${ELEVENLABS_API_URL}/${voiceId}`, 
        {
          text: `Hello, this is a test from the ${voiceName} voice.`, // Short test text
          model_id: "eleven_multilingual_v2", // Use a common multilingual model
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
          timeout: 10000, // 10 seconds timeout for each request
        }
      );

      if (response.status === 200) {
        const filePath = path.join(outputDir, `${voiceName}.mp3`);
        fs.writeFileSync(filePath, response.data);
        console.log(`✅ Success: ${voiceName}. Audio saved to ${filePath}`);
      } else {
        console.error(`❌ Failed: ${voiceName}. Status: ${response.status}`);
      }
    } catch (error: any) {
      if (error.response) {
        console.error(`❌ Failed: ${voiceName}. Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data.toString())}`);
      } else if (error.code === 'ECONNABORTED') {
        console.error(`❌ Failed: ${voiceName}. Request timed out.`);
      } else {
        console.error(`❌ Failed: ${voiceName}. Error: ${error.message}`);
      }
    }
  }

  console.log('\nElevenLabs voice ID testing complete.');
}

testElevenLabsVoices();
