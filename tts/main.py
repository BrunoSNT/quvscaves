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

# Use GPU if available
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
            cls._instance.sample_rate = 24000  # possibility: use a lower sample rate for speed
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
                # Optionally, load a quantized or FP16 variant if Kokoro supports it.
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
    speed: Optional[float] = 1.25
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

async def generate_audio(text: str, engine: str = 'kokoro', voice: Optional[str] = None, speed: float = 1.25) -> io.BytesIO:
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
        
        # Save as WAV to an in-memory buffer
        buffer = io.BytesIO()
        sf.write(buffer, combined_audio, tts_engine.sample_rate, format='WAV')
        buffer.seek(0)  # Reset buffer to the beginning
        
        return buffer

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

                audio_buffer = await generate_audio(
                    text=request.text,
                    engine=request.engine,
                    voice=voice,
                    speed=request.speed
                )

                # First yield a status message
                yield b'{"status": "started"}\n'

                # Then yield the actual audio data from the buffer
                while chunk := audio_buffer.read(4096):
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

@app.post("/tts/stream")
async def text_to_speech_stream(request: TTSRequest):
    """Streaming TTS endpoint that handles text chunks and returns audio chunks"""
    try:
        # Get language code from voice
        voice = request.voice or 'af_heart'
        lang_code = get_lang_code(voice)

        # Reinitialize Kokoro with correct language if needed
        if tts_engine.kokoro.lang_code != lang_code:
            tts_engine.kokoro = KPipeline(lang_code=lang_code, device=device)

        async def generate_audio_chunks():
            try:
                pipeline = tts_engine.get_kokoro()
                
                # Split text into smaller chunks for faster processing
                sentences = request.text.replace('...', '.').split('. ')
                first_chunk = True
                all_audio = []
                
                # First yield a status message
                yield b'{"status": "started"}\n'

                for i, sentence in enumerate(sentences):
                    if not sentence.strip():
                        continue
                        
                    # Add period back if it's not the last sentence
                    if i < len(sentences) - 1:
                        sentence += '.'
                    
                    # Generate audio for this sentence
                    generator = pipeline(
                        sentence,
                        voice=voice,
                        speed=request.speed,
                        split_pattern=None  # Don't split further, we already have small chunks
                    )

                    for _, _, audio in generator:
                        # Convert tensor to numpy array if needed
                        if torch.is_tensor(audio):
                            audio = audio.cpu().numpy()
                        
                        # Convert to int16 format
                        audio_int16 = (audio * 32767).astype(np.int16)
                        
                        # Create WAV in memory
                        buffer = io.BytesIO()
                        with wave.open(buffer, 'wb') as wav_file:
                            wav_file.setnchannels(1)  # mono
                            wav_file.setsampwidth(2)  # 16-bit
                            wav_file.setframerate(tts_engine.sample_rate)
                            wav_file.writeframes(audio_int16.tobytes())
                        
                        buffer.seek(0)
                        
                        # If this is the first chunk, emit it immediately
                        if first_chunk:
                            yield buffer.read()
                            first_chunk = False
                        else:
                            # For subsequent chunks, we'll store them
                            all_audio.append(audio)
                            
                            # Every few chunks, combine and send
                            if len(all_audio) >= 2:
                                # Combine stored chunks
                                combined = np.concatenate(all_audio)
                                all_audio = []
                                
                                # Convert to int16
                                combined_int16 = (combined * 32767).astype(np.int16)
                                
                                # Create WAV
                                buffer = io.BytesIO()
                                with wave.open(buffer, 'wb') as wav_file:
                                    wav_file.setnchannels(1)
                                    wav_file.setsampwidth(2)
                                    wav_file.setframerate(tts_engine.sample_rate)
                                    wav_file.writeframes(combined_int16.tobytes())
                                
                                buffer.seek(0)
                                yield buffer.read()

                # Send any remaining audio
                if all_audio:
                    combined = np.concatenate(all_audio)
                    combined_int16 = (combined * 32767).astype(np.int16)
                    
                    buffer = io.BytesIO()
                    with wave.open(buffer, 'wb') as wav_file:
                        wav_file.setnchannels(1)
                        wav_file.setsampwidth(2)
                        wav_file.setframerate(tts_engine.sample_rate)
                        wav_file.writeframes(combined_int16.tobytes())
                    
                    buffer.seek(0)
                    yield buffer.read()

            except Exception as e:
                logger.error(f"Error in TTS generation: {e}")
                yield b'{"status": "error", "message": "' + str(e).encode() + b'"}\n'

        return StreamingResponse(
            generate_audio_chunks(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": f"attachment; filename=output_audio.wav",
                "X-Accel-Buffering": "no",
                "Transfer-Encoding": "chunked"
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