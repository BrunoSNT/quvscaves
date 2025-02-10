import os
import sys
import json
import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, AsyncGenerator
import torch
from ChatTTS import Chat
import logging
import numpy as np
from pydub import AudioSegment
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global TTS instance and task tracking
tts_instance = None
active_tasks: Dict[str, float] = {}
app = FastAPI()

class TTSRequest(BaseModel):
    text: str
    speed: Optional[float] = 1.0

def get_tts():
    """Get or create TTS instance (singleton pattern)"""
    global tts_instance
    if tts_instance is None:
        logger.info("Creating new TTS instance...")
        tts_instance = Chat()
        
        # Try to use GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")
        
        if tts_instance.load():
            logger.info("Models loaded successfully")
        else:
            logger.error("Failed to load models")
            raise RuntimeError("Failed to load TTS models")
            
    return tts_instance

@app.on_event("startup")
async def startup_event():
    """Initialize TTS on server startup"""
    try:
        get_tts()
        logger.info("TTS Server ready!")
    except Exception as e:
        logger.error(f"Failed to initialize TTS: {e}")
        sys.exit(1)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    if tts_instance is None:
        raise HTTPException(status_code=503, detail="TTS not initialized")
    return {
        "status": "healthy", 
        "tts_loaded": True,
        "active_tasks": len(active_tasks)
    }

def estimate_processing_time(text: str) -> int:
    """Estimate processing time based on text length"""
    # More generous estimate: 2 seconds per 15 characters
    return max(30, (len(text) // 15) * 2)

async def generate_audio_chunks(text: str) -> AsyncGenerator[bytes, None]:
    """Generate audio in chunks to avoid timeouts"""
    tts = get_tts()
    
    # Split text into sentences or chunks
    chunks = text.split('. ')
    if len(chunks) == 1:
        # If no sentences, split by commas
        chunks = text.split(',')
    if len(chunks) == 1:
        # If still one chunk, split by length
        chunks = [text[i:i+100] for i in range(0, len(text), 100)]
    
    audio_chunks = []
    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
            
        try:
            # Generate audio for chunk
            audio = await asyncio.to_thread(tts.infer, chunk.strip())
            if audio is not None:
                audio_chunks.append(audio)
                
        except Exception as e:
            logger.error(f"Error generating chunk {i}: {e}")
            continue
    
    if not audio_chunks:
        raise HTTPException(status_code=500, detail="Failed to generate any audio")
    
    # Combine chunks
    combined_audio = np.concatenate(audio_chunks)
    
    # Convert to audio segment
    audio_segment = AudioSegment(
        combined_audio.tobytes(),
        frame_rate=24000,
        sample_width=2,
        channels=1
    )
    
    # Save as MP3
    timestamp = int(time.time())
    output_filename = f"output_audio_{timestamp}.mp3"
    output_dir = os.path.join(os.path.dirname(__file__), "output")
    output_path = os.path.join(output_dir, output_filename)
    
    os.makedirs(output_dir, exist_ok=True)
    
    audio_segment.export(
        output_path,
        format="mp3",
        bitrate="192k",
        parameters=["-ac", "1", "-ar", "24000"]
    )
    
    # Stream the file
    with open(output_path, 'rb') as f:
        while chunk := f.read(8192):
            yield chunk
    
    # Cleanup file after streaming
    try:
        os.remove(output_path)
    except Exception as e:
        logger.error(f"Error cleaning up file: {e}")

@app.post("/tts")
async def generate_speech(request: TTSRequest, background_tasks: BackgroundTasks):
    try:
        # Stream the audio generation
        return StreamingResponse(
            generate_audio_chunks(request.text),
            media_type="audio/mpeg",
            headers={
                "X-Processing-Time": str(estimate_processing_time(request.text))
            }
        )
        
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        timeout_keep_alive=120
    )