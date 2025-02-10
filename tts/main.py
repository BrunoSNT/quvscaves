print("TTS server is starting...")

import os
import sys
import json
import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks, Response, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, Literal
import torch
import logging
import numpy as np
from pydub import AudioSegment
import time
from kokoro import KPipeline
import soundfile as sf
import warnings
import io
import wave
import struct

# Suppress warnings
warnings.filterwarnings('ignore')

# Configure device to use CPU
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

       
class TTSEngine:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TTSEngine, cls).__new__(cls)
            cls._instance.kokoro = None
            cls._instance.sample_rate = 24000
            cls._instance.initialized = False
            cls._instance.initialized_engines = set()
        return cls._instance

    def initialize(self, engine_type: str = 'kokoro'):
        """Initialize TTS engine. Only Kokoro is supported."""
        print("TTS server is initializing...")
        if self.initialized and engine_type in self.initialized_engines:
            return

        if engine_type in ['kokoro', 'all'] and 'kokoro' not in self.initialized_engines:
            # Initialize Kokoro
            logger.info("Initializing Kokoro...")
            try:
         # Initialize with English first (we'll switch language as needed)
                self.kokoro = KPipeline(lang_code='a', device=device)
                logger.info(f"Kokoro models loaded successfully on device: {device}")
                self.initialized_engines.add('kokoro')
            except Exception as e:
                logger.error(f"Failed to load Kokoro models: {e}")
                raise RuntimeError("Failed to load Kokoro models")
        
        self.initialized = True
        logger.info(f"TTS Engine initialized successfully: {', '.join(self.initialized_engines)}")

    def get_kokoro(self):
        if not self.initialized or 'kokoro' not in self.initialized_engines:
            print("Kokoro starting...")
            self.initialize('kokoro')
        return self.kokoro

# Global TTS engine instance
tts_engine = TTSEngine()

# Global task tracking
active_tasks: Dict[str, float] = {}
app = FastAPI()

class TTSRequest(BaseModel):
    text: str
    speed: Optional[float] = 1.0
    engine: Optional[Literal['kokoro']] = 'kokoro'
    voice: Optional[str] = None  # For Kokoro voices

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on server startup"""
    try:
        # Don't initialize engine by default
        # It will be initialized on-demand when requested
        logger.info("TTS Server ready!")
    except Exception as e:
        logger.error(f"Failed to initialize TTS server: {e}")
        sys.exit(1)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    # Engine must be initialized for the server to be healthy
    if not tts_engine.initialized or not tts_engine.initialized_engines:
        raise HTTPException(status_code=503, detail="TTS engine not initialized")
    return {"status": "healthy", "initialized_engines": list(tts_engine.initialized_engines)}

async def generate_audio(text: str, engine: str = 'kokoro', voice: Optional[str] = None, speed: float = 1.0) -> str:
    """Generate audio using Kokoro engine"""
    logger.info(f"Generating audio with Kokoro")
    try:
        # Initialize and use Kokoro for generation
        pipeline = tts_engine.get_kokoro()
        audio_chunks = []

        # Generate audio with Kokoro
        generator = pipeline(
            text,
            voice=voice or 'af_heart',
            speed=speed,
            split_pattern=r'\n+'
        )

        # Process chunks
        for _, _, audio in generator:
            audio_chunks.append(audio)

        if not audio_chunks:
            raise RuntimeError("No audio was generated")

        # Combine chunks
        combined_audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
        
        # Save as WAV
        timestamp = int(time.time())
        output_filename = f"output_audio_{timestamp}.wav"
        output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
        output_path = os.path.join(output_dir, output_filename)
        
        os.makedirs(output_dir, exist_ok=True)
        sf.write(output_path, combined_audio, 24000)
        
        return output_path

    except Exception as e:
        logger.error(f"Error generating audio: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    """TTS endpoint that handles Kokoro requests"""
    try:
        # First send a header to indicate generation has started
        async def generate_response():
            try:
                # Get language code from voice
                voice = request.voice or 'af_heart'
                lang_code = get_lang_code(voice)
                
                # Reinitialize Kokoro with correct language if needed
                if tts_engine.kokoro.lang_code != lang_code:
                    tts_engine.kokoro = KPipeline(lang_code=lang_code, device=device)
                
                output_path = await generate_audio(
                    text=request.text,
                    engine=request.engine,
                    voice=voice,
                    speed=request.speed
                )
                
                # First yield a status message
                yield b'{"status": "started"}\n'
                
                # Then yield the actual audio data
                with open(output_path, 'rb') as f:
                    while chunk := f.read(8192):
                        yield chunk
                
            except Exception as e:
                logger.error(f"Error in TTS generation: {e}")
                yield b'{"status": "error", "message": "' + str(e).encode() + b'"}\n'
        
        return StreamingResponse(
            generate_response(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": f"attachment; filename=output_audio.wav",
                "X-Accel-Buffering": "no"
            }
        )
        
    except Exception as e:
        logger.error(f"Error in TTS endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    
    # Initialize TTS engine before starting the server
    try:
        tts_engine.initialize()
        uvicorn.run(app, host="0.0.0.0", port=8000)
    except Exception as e:
        logger.error(f"Failed to start TTS server: {e}")
        sys.exit(1)