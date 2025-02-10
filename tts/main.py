print("TTS server is starting...")

import os
import sys
import json
import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
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
        timestamp = int(time.time())
        output_filename = f"output_audio_{timestamp}.mp3"
        output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
        output_path = os.path.join(output_dir, output_filename)
        wav_path = output_path.replace('.mp3', '.wav')

        # Ensure output directory exists with proper permissions
        os.makedirs(output_dir, exist_ok=True)
        os.chmod(output_dir, 0o755)  # rwxr-xr-x
        
        logger.info(f"Directory: {output_dir}")
        logger.info(f"WAV path: {wav_path}")
        logger.info(f"MP3 path: {output_path}")

        # Initialize and use Kokoro for generation
        pipeline = tts_engine.get_kokoro()  # This will initialize only Kokoro if needed
        audio_chunks = []
        logger.info(f"Engine OK! - Chunks Declared Empty")

        # Generate audio with Kokoro
        generator = pipeline(
            text,
            voice=voice or 'af_heart',  # Default to af_heart if no voice specified
            speed=speed,
            split_pattern=r'\n+'
        )
        logger.info(f"Pipeline Set")

        for _, _, audio in generator:
            audio_chunks.append(audio)
            logger.info(f"Chunk appended, length: {len(audio)}")

        if not audio_chunks:
            raise RuntimeError("No audio was generated")

        # Combine chunks if multiple
        if len(audio_chunks) > 1:
            combined_audio = np.concatenate(audio_chunks)
            logger.info(f"Chunks Combined - Total length: {len(combined_audio)}")
        else:
            combined_audio = audio_chunks[0]
            logger.info(f"Single Chunk - Length: {len(combined_audio)}")
        
        # Save as WAV first (Kokoro's native format)
        logger.info(f"Saving WAV file to: {wav_path}")
        sf.write(wav_path, combined_audio, 24000)
        
        # Verify WAV file exists and has content
        if not os.path.exists(wav_path):
            raise RuntimeError(f"Failed to save WAV file at {wav_path}")
        
        wav_size = os.path.getsize(wav_path)
        logger.info(f"WAV file created successfully, size: {wav_size} bytes")

        # Convert to MP3
        logger.info(f"Converting to MP3: {output_path}")
        audio_segment = AudioSegment.from_wav(wav_path)
        audio_segment.export(
            output_path,
            format="mp3",
            bitrate="192k",
            parameters=[
                "-ac", "1",
                "-ar", "24000",
                "-b:a", "192k",
                "-joint_stereo", "0"
            ]
        )

        # Verify MP3 file exists and has content
        if not os.path.exists(output_path):
            raise RuntimeError(f"Failed to create MP3 file at {output_path}")
        
        mp3_size = os.path.getsize(output_path)
        logger.info(f"MP3 file created successfully, size: {mp3_size} bytes")

        return output_path

    except Exception as e:
        logger.error(f"Error generating audio: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error traceback: {sys.exc_info()[2]}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    """TTS endpoint that handles Kokoro requests"""
    try:
        logger.debug(f"Received TTS request: {request.dict()}")
        
        # Generate audio file
        output_path = await generate_audio(
            text=request.text,
            engine=request.engine,
            voice=request.voice,
            speed=request.speed
        )
        
        # Verify file exists before sending
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500,
                detail=f"Generated file not found at {output_path}"
            )
        
        # Return audio file
        return FileResponse(
            output_path,
            media_type="audio/mpeg",
            headers={"Content-Disposition": f"attachment; filename={os.path.basename(output_path)}"}
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