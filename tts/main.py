print("TTS server is starting...")

import os
import sys
import json
import asyncio
import base64
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

# Configure logging with more detailed format
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - [%(name)s] - %(message)s'
)
logger = logging.getLogger(__name__)

# Add file handler for persistent logging
file_handler = logging.FileHandler('tts_server.log')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - [%(name)s] - %(message)s'))
logger.addHandler(file_handler)

# Suppress warnings
warnings.filterwarnings('ignore')

device = torch.device("cpu")
logger.info(f"Using device: {device}")

# Suppress tqdm progress bars
os.environ['TQDM_DISABLE'] = '1'

# Get language code from voice prefix
def get_lang_code(voice: str) -> str:
    prefix = voice[:2]
    mapping = {
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
    }
    lang_code = mapping.get(prefix, 'a')
    logger.debug(f"Voice prefix '{prefix}' mapped to language code '{lang_code}'")
    return lang_code

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
        logger.info(f"Initializing TTSEngine for language code '{lang_code}' with voice '{self.voice}'")
        self.initialize()

    def initialize(self):
        logger.info(f"Initializing Kokoro for language: {self.lang_code}...")
        try:
            from kokoro import KPipeline
            self.kokoro = KPipeline(lang_code=self.lang_code, device=device)
            logger.info(f"Kokoro initialized successfully on device: {device} for language: {self.lang_code}")
        except Exception as e:
            logger.error(f"Failed to initialize Kokoro: {str(e)}", exc_info=True)
            raise RuntimeError(f"Failed to initialize Kokoro for language: {self.lang_code}")

# Global TTS engine instances for each language
logger.info("Initializing global TTS engines...")
tts_engines: Dict[str, TTSEngine] = {
    'a': TTSEngine('a'),  # English
    'p': TTSEngine('p'),  # Portuguese
}
logger.info(f"Initialized {len(tts_engines)} TTS engines")

app = FastAPI()

@app.get("/health")
async def health_check():
    logger.debug("Health check requested")
    return {"status": "healthy"}

@app.post("/tts/stream")
async def text_to_speech_stream(request: TTSRequest):
    try:
        logger.info(f"Streaming TTS request received: voice={request.voice}, text_length={len(request.text)}")
        lang_code = get_lang_code(request.voice)
        if lang_code not in tts_engines:
            logger.error(f"Unsupported language code: {lang_code}")
            raise HTTPException(status_code=400, detail=f"Unsupported language for voice: {request.voice}")

        tts_engine = tts_engines[lang_code]
        tts_engine.voice = request.voice
        logger.debug(f"Using TTS engine for language '{lang_code}' with voice '{request.voice}'")

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
                logger.debug("Started streaming audio chunks")

                chunk_count = 0
                for _, _, audio in generator:
                    if audio is not None:  # Check for None audio
                        # Convert to WAV chunk
                        buffer = io.BytesIO()
                        sf.write(buffer, audio.cpu().numpy(), tts_engine.sample_rate, format='WAV')
                        buffer.seek(0)
                        chunk_data = buffer.read()
                        chunk_count += 1
                        logger.debug(f"Generated audio chunk {chunk_count}: {len(chunk_data)} bytes")
                        yield chunk_data

                logger.info(f"Completed streaming {chunk_count} audio chunks")

            except Exception as e:
                logger.error(f"Error during audio generation: {str(e)}", exc_info=True)
                # Send an error status message
                error_message = json.dumps({"status": "error", "message": str(e)}) + "\n"
                yield error_message.encode()

        return StreamingResponse(generate_audio_chunks(), media_type="audio/wav")

    except Exception as e:
        logger.error(f"Error in TTS generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    try:
        logger.info(f"TTS request received: voice={request.voice}, text_length={len(request.text)}")
        lang_code = get_lang_code(request.voice)
        if lang_code not in tts_engines:
            logger.error(f"Unsupported language code: {lang_code}")
            raise HTTPException(status_code=400, detail=f"Unsupported language for voice: {request.voice}")
    
        tts_engine = tts_engines[lang_code]
        tts_engine.voice = request.voice
        logger.debug(f"Using TTS engine for language '{lang_code}' with voice '{request.voice}'")

        # Normalize text by replacing newlines with spaces and trimming
        normalized_text = " ".join(request.text.split())
        logger.info(f"Generating audio for text: {normalized_text[:100]}...")
        
        generator = tts_engine.kokoro(
            normalized_text,
            speed=request.speed,
            voice=request.voice
        )
    
        async def generate_audio():
            total_bytes = 0
            chunk_count = 0
            # Only yield raw WAV bytes
            for _, _, audio in generator:
                if audio is not None:
                    buffer = io.BytesIO()
                    sf.write(buffer, audio.cpu().numpy(), tts_engine.sample_rate, format='WAV')
                    buffer.seek(0)
                    chunk_data = buffer.read()
                    total_bytes += len(chunk_data)
                    chunk_count += 1
                    logger.debug(f"Generated audio chunk {chunk_count}: {len(chunk_data)} bytes")
                    yield chunk_data
            
            logger.info(f"Completed audio generation: {chunk_count} chunks, {total_bytes} total bytes")
    
        # Move TTS metadata to HTTP response headers
        encoded_text = base64.b64encode(normalized_text.encode("utf-8")).decode("ascii")
        response_headers = {
            "X-TTS-Text-Base64": encoded_text,
            "X-TTS-Voice": request.voice
        }
    
        return StreamingResponse(generate_audio(), media_type="audio/wav", headers=response_headers)
    
    except Exception as e:
        logger.error(f"Error in TTS generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting TTS server...")
    uvicorn.run(app, host="0.0.0.0", port=8000)