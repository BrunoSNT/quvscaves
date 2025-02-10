from ChatTTS import Chat
import logging
import os
import time
import numpy as np
from pydub import AudioSegment
import io
import sys
import warnings
import torch
import json

# Suppress warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout
)

# Suppress tqdm progress bars
os.environ['TQDM_DISABLE'] = '1'

logger = logging.getLogger(__name__)

class TTSServer:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TTSServer, cls).__new__(cls)
            cls._instance.tts = None
            cls._instance.sample_rate = 24000
            cls._instance.initialized = False
            cls._instance.audio_cache = {}  # Simple cache for repeated phrases
            cls._instance.cache_size = 100  # Maximum cache entries
        return cls._instance

    def initialize(self):
        if self.initialized:
            return
        
        logger.info("Initializing ChatTTS...")
        self.tts = Chat()
        
        # Try to use GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cpu":
            logger.warning("GPU not available, using CPU. This will be slower.")
            
        # Only load models, skip download check
        logger.info("Loading models...")
        self.tts.load()
        self.initialized = True
        logger.info("Initialization complete!")

    def process_text(self, text):
        if not text:
            return None
            
        try:
            # Check cache first
            cache_key = text.strip().lower()
            if cache_key in self.audio_cache:
                logger.info("Using cached audio")
                # Send progress update
                sys.stdout.write(json.dumps({"status": "progress", "progress": 100}) + "\n")
                sys.stdout.flush()
                return self.audio_cache[cache_key]
            
            # Generate audio with progress updates
            logger.info("Generating speech...")
            
            # Send initial progress
            sys.stdout.write(json.dumps({"status": "progress", "progress": 0}) + "\n")
            sys.stdout.flush()
            
            # Start audio generation
            audio = None
            for i, chunk in enumerate(self.tts.infer_stream(text)):
                if i == 0:  # First chunk
                    audio = chunk
                else:
                    audio = np.concatenate((audio, chunk))
                
                # Send progress update (estimate based on chunk count)
                progress = min(95, int((i + 1) * 20))  # Cap at 95% until final processing
                sys.stdout.write(json.dumps({"status": "progress", "progress": progress}) + "\n")
                sys.stdout.flush()
            
            if audio is None or len(audio) == 0:
                logger.error("No audio generated")
                return None
            
            # Send progress update for final processing
            sys.stdout.write(json.dumps({"status": "progress", "progress": 98}) + "\n")
            sys.stdout.flush()
            
            # Save the audio
            timestamp = int(time.time())
            output_filename = f"output_audio_{timestamp}.mp3"
            output_path = os.path.join("output", output_filename)
            
            if save_audio(audio, output_path, self.sample_rate):
                # Cache the result
                if len(self.audio_cache) >= self.cache_size:
                    # Remove oldest entry
                    self.audio_cache.pop(next(iter(self.audio_cache)))
                self.audio_cache[cache_key] = os.path.abspath(output_path)
                
                # Send completion progress
                sys.stdout.write(json.dumps({"status": "progress", "progress": 100}) + "\n")
                sys.stdout.flush()
                
                return self.audio_cache[cache_key]
            
            return None
            
        except Exception as e:
            logger.error(f"Error processing text: {str(e)}")
            return None

def save_audio(audio_data, output_path, sample_rate=24000):
    """Convert numpy array to MP3 and save it with settings optimized for Discord playback."""
    try:
        # Ensure audio_data is a numpy array
        if isinstance(audio_data, list):
            audio_data = np.array(audio_data)
        
        # Normalize audio to prevent clipping
        max_val = np.max(np.abs(audio_data))
        if max_val > 0:
            audio_data = audio_data / max_val * 0.95  # Leave some headroom
        
        # Convert to 16-bit PCM
        audio_int16 = (audio_data * 32767).astype(np.int16)
        
        # Create AudioSegment with specific settings for Discord
        audio_segment = AudioSegment(
            audio_int16.tobytes(), 
            frame_rate=sample_rate,
            sample_width=2,  # 16-bit
            channels=1       # Mono
        )
        
        # Ensure proper volume
        target_dbfs = -14.0  # Standard loudness target
        current_dbfs = audio_segment.dBFS
        if current_dbfs < float('-inf'):
            # Handle silent audio
            logger.warning("Silent audio detected")
        else:
            change_in_dbfs = target_dbfs - current_dbfs
            audio_segment = audio_segment.apply_gain(change_in_dbfs)
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Export as MP3 with specific settings for Discord
        audio_segment.export(
            output_path, 
            format="mp3",
            bitrate="192k",  # Reduced bitrate for better streaming
            parameters=[
                "-ar", str(sample_rate),  # Maintain sample rate
                "-ac", "1",               # Force mono
                "-b:a", "192k",           # Consistent bitrate
                "-joint_stereo", "0",     # Disable joint stereo
                "-compression_level", "0"  # Fast encoding
            ]
        )
        logger.info(f"Audio saved to: {output_path}")
        return True
    except Exception as e:
        logger.error(f"Error saving audio: {str(e)}")
        return False

def main():
    try:
        # Create TTS server instance
        server = TTSServer()
        
        # Initialize the server
        server.initialize()
        
        # Process commands from stdin
        for line in sys.stdin:
            try:
                # Parse command
                command = line.strip()
                if not command:
                    continue
                
                # Process the text
                output_path = server.process_text(command)
                
                if output_path:
                    # Send success response
                    response = {"status": "success", "path": output_path}
                else:
                    # Send error response
                    response = {"status": "error", "message": "Failed to generate audio"}
                
                # Write response
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                
            except Exception as e:
                # Send error response
                error_response = {"status": "error", "message": str(e)}
                sys.stdout.write(json.dumps(error_response) + "\n")
                sys.stdout.flush()

    except KeyboardInterrupt:
        logger.error("Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error in main process: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 