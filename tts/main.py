print("TTS server is starting...")

import os
import sys
import json
import asyncio
import base64
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, List
import torch
import logging
import numpy as np
import soundfile as sf
import warnings
import io
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
import importlib.util
import time

# Configure logging with more detailed format
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - [%(name)s] - %(message)s'
)
logger = logging.getLogger(__name__)

# Suppress warnings
warnings.filterwarnings('ignore')

device = torch.device("cpu")
logger.info(f"Using device: {device}")

# Suppress tqdm progress bars
os.environ['TQDM_DISABLE'] = '1'

def check_dependencies():
    required_packages = {
        'kokoro': 'kokoro',
        'misaki': 'misaki'
    }
    
    missing = []
    for package, requirement in required_packages.items():
        if importlib.util.find_spec(package) is None:
            missing.append(requirement)
    
    if missing:
        logger.error(f"Missing required packages: {', '.join(missing)}")
        logger.error("Please install missing packages using:")
        logger.error(f"pip install {' '.join(missing)}")
        sys.exit(1)

# Check dependencies before proceeding
check_dependencies()

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
        self.lock = Lock()
        self.initialized = False
        logger.info(f"Initializing TTSEngine for language code '{lang_code}' with voice '{self.voice}'")
        self.initialize()

    def initialize(self):
        if self.initialized:
            return

        logger.info(f"Initializing Kokoro for language: {self.lang_code}...")
        try:
            # Import kokoro directly
            import kokoro
            from kokoro import KPipeline

            # Initialize with only supported arguments
            self.kokoro = KPipeline(
                lang_code=self.lang_code, 
                device=device
            )
            self.initialized = True
            logger.info(f"Kokoro initialized successfully on device: {device} for language: {self.lang_code}")
        except Exception as e:
            logger.error(f"Failed to initialize Kokoro: {str(e)}", exc_info=True)
            raise RuntimeError(f"Failed to initialize Kokoro for language: {self.lang_code}")

    def generate(self, text: str, voice: str, speed: float) -> bytes:
        with self.lock:
            try:
                if not self.initialized:
                    self.initialize()

                # Generate audio in chunks
                audio_chunks = []
                for _, _, audio in self.kokoro(text, speed=speed, voice=voice):
                    if audio is not None:
                        buffer = io.BytesIO()
                        sf.write(buffer, audio.cpu().numpy(), self.sample_rate, format='WAV')
                        buffer.seek(0)
                        audio_chunks.append(buffer.read())
                
                # Combine all chunks into a single audio buffer
                return b''.join(audio_chunks)
            except Exception as e:
                logger.error(f"Error generating audio: {str(e)}", exc_info=True)
                raise

class TTSEnginePool:
    def __init__(self, lang_code: str, pool_size: int = 2):
        self.engines = []
        self.current_engine = 0
        self.lock = Lock()
        
        for _ in range(pool_size):
            try:
                engine = TTSEngine(lang_code)
                self.engines.append(engine)
            except Exception as e:
                logger.error(f"Failed to initialize engine {len(self.engines) + 1}: {str(e)}")
                if len(self.engines) == 0:
                    raise  # Re-raise if we couldn't initialize any engines
        
        logger.info(f"Initialized {len(self.engines)} engines for language {lang_code}")

    def get_next_engine(self) -> TTSEngine:
        with self.lock:
            engine = self.engines[self.current_engine]
            self.current_engine = (self.current_engine + 1) % len(self.engines)
            return engine

# Initialize engine pools with retry logic
def initialize_engine_pools(retries=3, delay=2):
    for attempt in range(retries):
        try:
            pools = {
                'a': TTSEnginePool('a'),  # English
                'p': TTSEnginePool('p'),  # Portuguese
            }
            logger.info(f"Successfully initialized TTS engine pools")
            return pools
        except Exception as e:
            if attempt < retries - 1:
                logger.warning(f"Attempt {attempt + 1} failed, retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                logger.error("Failed to initialize TTS engine pools after all retries")
                raise

# Global TTS engine pools
logger.info("Initializing TTS engine pools...")
tts_pools = initialize_engine_pools()

# Thread pool for parallel processing
thread_pool = ThreadPoolExecutor(max_workers=4)

app = FastAPI()

@app.get("/health")
async def health_check():
    logger.debug("Health check requested")
    return {"status": "healthy"}

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    try:
        logger.info(f"TTS request received: voice={request.voice}, text_length={len(request.text)}")
        lang_code = get_lang_code(request.voice)
        if lang_code not in tts_pools:
            logger.error(f"Unsupported language code: {lang_code}")
            raise HTTPException(status_code=400, detail=f"Unsupported language for voice: {request.voice}")

        # Get the next available engine from the pool
        engine = tts_pools[lang_code].get_next_engine()

        try:
            # Normalize text by replacing newlines with spaces and trimming
            normalized_text = " ".join(request.text.split())
            logger.info(f"Generating audio for text: {normalized_text[:100]}...")

            # Generate audio in a thread pool
            audio_future = thread_pool.submit(
                engine.generate,
                normalized_text,
                request.voice,
                request.speed or 1.0
            )

            async def generate_audio():
                try:
                    audio_data = await asyncio.get_event_loop().run_in_executor(
                        None, audio_future.result
                    )
                    yield audio_data
                    logger.info(f"Completed audio generation")
                except Exception as e:
                    logger.error(f"Error generating audio: {str(e)}")
                    raise

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

    except Exception as e:
        logger.error(f"Error in TTS request: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting TTS server...")
    uvicorn.run(app, host="0.0.0.0", port=8000)