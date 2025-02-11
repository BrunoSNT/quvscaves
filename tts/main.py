print("TTS server is starting...")

import os
import sys
import json
import asyncio
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict
import torch
import logging
import numpy as np
import soundfile as sf
import warnings
import io

# Suppress warnings
warnings.filterwarnings('ignore')

device = torch.device("cpu")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Suppress tqdm progress bars
os.environ['TQDM_DISABLE'] = '1'

# Get language code from voice prefix
def get_lang_code(voice: str) -> str:
    prefix = voice[:2]
    return {
        'am': 'a',  # English male
        'af': 'a',  # English female
        'bm': 'a',  # English male
        'ef': 'e',  # Spanish
        'ff': 'f',  # French
        'jf': 'j',  # Japanese
        'zf': 'z',  # Chinese
        'hf': 'h',  # Hindi
        'if': 'i',  # Italian
        'pm': 'p',  # Portuguese male
        'pf': 'p',  # Portuguese female
    }.get(prefix, 'a')  # Default to English if unknown

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "af_heart"  # Default to English
    speed: Optional[float] = 1.0

class TTSEngine:
    def __init__(self, lang_code: str):
        self.kokoro = None
        self.sample_rate = 24000
        self.lang_code = lang_code
        self.voice = "af_heart" if lang_code == 'a' else 'pm_alex'
        self.initialize()

    def initialize(self):
        logger.info(f"Initializing Kokoro for language: {self.lang_code}...")
        try:
            from kokoro import KPipeline
            self.kokoro = KPipeline(lang_code=self.lang_code, device=device)
            logger.info(f"Kokoro initialized on device: {device} for language: {self.lang_code}")
        except Exception as e:
            logger.error(f"Failed to initialize Kokoro: {e}")
            raise RuntimeError(f"Failed to initialize Kokoro for language: {self.lang_code}")

# Global TTS engine instances for each language
tts_engines: Dict[str, TTSEngine] = {
    'a': TTSEngine('a'),  # English
    'p': TTSEngine('p'),  # Portuguese
}
app = FastAPI()

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/tts/stream")
async def text_to_speech_stream(request: TTSRequest):
    try:
        lang_code = get_lang_code(request.voice)
        if lang_code not in tts_engines:
            raise HTTPException(status_code=400, detail=f"Unsupported language for voice: {request.voice}")

        tts_engine = tts_engines[lang_code]
        tts_engine.voice = request.voice

        # Generate audio (streaming)
        generator = tts_engine.kokoro(
            request.text,
            speed=request.speed,
            voice=request.voice
        )

        async def generate_audio_chunks():
            try:
                # First, send a status message.
                status_message = json.dumps({"status": "started"}) + "\n"
                yield status_message.encode()

                for _, _, audio in generator:
                    if audio is not None:  # Check for None audio
                        # Convert to WAV chunk
                        buffer = io.BytesIO()
                        sf.write(buffer, audio.cpu().numpy(), tts_engine.sample_rate, format='WAV')
                        buffer.seek(0)
                        yield buffer.read()

            except Exception as e:
                logger.error(f"Error during audio generation: {e}")
                # Send an error status message
                error_message = json.dumps({"status": "error", "message": str(e)}) + "\n"
                yield error_message.encode()

        return StreamingResponse(generate_audio_chunks(), media_type="audio/wav")

    except Exception as e:
        logger.error(f"Error in TTS generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")  # Keep the /tts endpoint for non-streaming requests
async def text_to_speech(request: TTSRequest):
    try:
        lang_code = get_lang_code(request.voice)
        if lang_code not in tts_engines:
            raise HTTPException(status_code=400, detail=f"Unsupported language for voice: {request.voice}")

        tts_engine = tts_engines[lang_code]
        tts_engine.voice = request.voice

        generator = tts_engine.kokoro(
            request.text,
            speed=request.speed,
            voice=request.voice
        )

        # Process all chunks (non-streaming)
        audio_chunks = []
        for _, _, audio in generator:
            if audio is not None: # Check for None
                audio_chunks.append(audio)

        if not audio_chunks:
            raise RuntimeError("No audio was generated")

        # Combine chunks
        combined_audio = audio_chunks[0] if len(audio_chunks) == 1 else torch.cat(audio_chunks)

        # Convert to WAV
        buffer = io.BytesIO()
        sf.write(buffer, combined_audio.cpu().numpy(), tts_engine.sample_rate, format='WAV') # Convert to numpy array
        buffer.seek(0)

        # Return audio as streaming response (even though it's not truly streaming)
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=output.wav"
            }
        )

    except Exception as e:
        logger.error(f"Error in TTS generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)