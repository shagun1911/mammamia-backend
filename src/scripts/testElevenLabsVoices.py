import os
from elevenlabs import ElevenLabs, save, Voice
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

ELEVEN_API_KEY = os.getenv("ELEVEN_API_KEY")
# Ensure ELEVEN_API_URL is configured for the correct residency
# If ELEVEN_API_URL is not set in .env, it defaults to the global ElevenLabs API.
# It's crucial to use the exact data residency base URL if applicable.
ELEVEN_API_URL = os.getenv("ELEVEN_API_URL", "https://api.elevenlabs.io/v1/")

if not ELEVEN_API_KEY:
    raise RuntimeError("ELEVEN_API_KEY not found in environment variables")

# Initialize ElevenLabs client
client = ElevenLabs(
    api_key=ELEVEN_API_KEY,
    base_url=ELEVEN_API_URL # Use the dynamically loaded URL
)

# Voice ID mapping from voice name to ElevenLabs voice ID
VOICE_ID_MAP = {
  'domenico': 'QABTI1ryPrQsJUflbKB7',
  'thomas': 'CITWdMEsnRduEUkNWXQv',
  'mario': 'irAl0cku0Hx4TEUJ8d1Q',
  'gianp': 'SpoXt7BywHwFLisCTpQ3',
  'vittorio': 'nH7uLS5UdEnvKEOAXtlQ',
  'ginevra': 'QITiGyM4owZBEf0QV8',
  'roberta': 'ZzFXkjuO1rPntDj6At5C',
  'giusy': '8KInRSd4DtD5L5gK7itu',
  'sami': 'kAzI34nYjizE0zON6rXv',
  'alejandro': 'YKUjKbMlejgvkOZlnnvt',
  'antonio': 'htFfPSZGJwjBv1CL0aMD',
  'el_faraon': '8mBRP99B2Ng2QwsJMFQl',
  'lumina': 'x5IDPSl4ZUbhosMmVFTk',
  'elena': 'tXgbXPnsMpKXkuTgvE3h',
  'sara': 'gD1IexrzCvsXPHUuT0s3',
  'zara': 'jqcCZkN6Knx8BJ5TBdYR',
  'brittney': 'kPzsL2i3teMYv0FxEYQ6',
  'julieanne': '8WaMCGQzWsKvf7sGPqjE',
  'allison': 'xctasy8Xp2cVO9HL9k',
  'jameson': 'Mu5jxyqZOLIGltFpfalg',
  'mark': 'UgBBYS2sOqTuMpoF3BR0',
  'archie': 'kmSVBPu7loj4ayNinwWM',
  'rachel':'21m00Tcm4TlvDq8ikWAM',
}

OUTPUT_DIR = "elevenlabs_test_outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def save_audio(audio_data, file_name):
    """Helper to save audio data."""
    file_path = os.path.join(OUTPUT_DIR, file_name)
    save(audio_data, file_path)
    print(f"✅ Audio saved to: {file_path}")

def list_elevenlabs_voices():
    """Lists all voices accessible to the API key."""
    print("\n--- Listing ElevenLabs voices accessible to this API key ---")
    try:
        # Assuming client.voices.get_all() is the correct method for the SDK
        voices = client.voices.get_all()
        if voices:
            print("✅ Successfully listed voices:")
            for v in voices:
                print(f"  - Name: {v.name}, ID: {v.voice_id}, Category: {v.category}, Labels: {v.labels}")
            return voices
        else:
            print("❌ No voices found or accessible.")
    except Exception as e:
        print(f"❌ Failed to list voices. Error: {e}")
    return []

def test_single_voice(voice_name, voice_id, is_default=False):
    """Tests a single ElevenLabs voice ID."""
    print(f"\n--- Testing voice: {voice_name} (ID: {voice_id}) ---")
    try:
        audio = client.text_to_speech.convert(
            voice_id=voice_id,
            model_id="eleven_multilingual_v2", # Or eleven_flash_v2_5 if preferred
            text=f"Hello, this is a test from the {voice_name} voice.",
            voice_settings={
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        )
        save_audio(audio, f"{voice_name.replace(' ', '_')}.mp3")
        print(f"✅ Success: {voice_name}")
        return True
    except Exception as e:
        print(f"❌ Failed: {voice_name}. Error: {e}")
        return False

def test_custom_voices():
    """Tests all custom voice IDs from VOICE_ID_MAP."""
    print("\n--- Starting ElevenLabs custom voice ID testing ---")
    all_success = True
    for voice_name, voice_id in VOICE_ID_MAP.items():
        if not test_single_voice(voice_name, voice_id):
            all_success = False
    print("\n--- ElevenLabs custom voice ID testing complete ---")
    return all_success

def test_known_default_voice():
    """Tests a known default ElevenLabs voice (Adam)."""
    DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"  # Adam
    DEFAULT_VOICE_NAME = "adam (default)"
    print(f"\n--- Testing known default voice: {DEFAULT_VOICE_NAME} ---")
    return test_single_voice(DEFAULT_VOICE_NAME, DEFAULT_VOICE_ID, is_default=True)


if __name__ == "__main__":
    print("Starting comprehensive ElevenLabs voice testing script...")
    
    # Method A: List all accessible voices
    accessible_voices = list_elevenlabs_voices()
    
    # Check if custom voices are in the accessible list
    print("\n--- Verifying custom voices against accessible list ---")
    for voice_name, voice_id in VOICE_ID_MAP.items():
        found = False
        for acc_voice in accessible_voices:
            if acc_voice['voice_id'] == voice_id:
                print(f"✅ Custom voice '{voice_name}' (ID: {voice_id}) found in accessible voices.")
                found = True
                break
        if not found:
            print(f"❌ Custom voice '{voice_name}' (ID: {voice_id}) NOT found in accessible voices.")

    # Test custom voices via TTS API
    custom_voices_test_result = test_custom_voices()

    # Method B: Test a known default voice
    default_voice_test_result = test_known_default_voice()

    print("\nComprehensive ElevenLabs voice testing complete.")
    print(f"Custom voices TTS test result: {'Success' if custom_voices_test_result else 'Failure'}")
    print(f"Default voice TTS test result: {'Success' if default_voice_test_result else 'Failure'}")
