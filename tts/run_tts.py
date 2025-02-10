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

# Suppress warnings
warnings.filterwarnings('ignore')

# Configure logging to be less verbose
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout
)

# Suppress tqdm progress bars
os.environ['TQDM_DISABLE'] = '1'

logger = logging.getLogger(__name__)

def save_audio(audio_data, output_path):
    """Convert numpy array to MP3 and save it with enhanced quality."""
    try:
        # Ensure audio_data is a numpy array
        if isinstance(audio_data, list):
            audio_data = np.array(audio_data)
        
        # Convert to 16-bit PCM
        audio_int16 = (audio_data * 32767).astype(np.int16)
        
        # Create AudioSegment from raw audio data
        audio_segment = AudioSegment(
            audio_int16.tobytes(), 
            frame_rate=24000,  # Keep original sample rate
            sample_width=2,    # 16-bit = 2 bytes
            channels=1         # Mono
        )
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Export as MP3 with a higher bitrate for better fidelity
        # Avoid resampling and normalization to preserve voice quality
        audio_segment.export(
            output_path, 
            format="mp3",
            bitrate="320k",  # Use highest quality MP3
            parameters=["-q:a", "0"]  # Use best quality setting
        )
        print(f"Audio saved to: {output_path}")  # Print for Node.js to capture
        return True
    except Exception as e:
        logger.error(f"Error saving audio: {str(e)}")
        return False

def load_mp3_as_waveform(mp3_path, target_sample_rate=24000):
    # Load the MP3 file
    audio = AudioSegment.from_mp3(mp3_path)
    # Ensure the audio is mono
    audio = audio.set_channels(1)
    # Resample the audio if necessary
    audio = audio.set_frame_rate(target_sample_rate)
    # Convert audio samples to a numpy array (assumes 16-bit PCM)
    samples = np.array(audio.get_array_of_samples()).astype(np.float32)
    # Normalize the samples (convert from int16 range to float range)
    samples /= np.iinfo(np.int16).max
    return samples

def chunk_text(text, max_length=200):
    """Split text into smaller chunks for faster processing."""
    words = text.split()
    chunks = []
    current_chunk = []
    current_length = 0
    
    for word in words:
        word_length = len(word)
        if current_length + word_length + 1 <= max_length:
            current_chunk.append(word)
            current_length += word_length + 1
        else:
            if current_chunk:
                chunks.append(' '.join(current_chunk))
            current_chunk = [word]
            current_length = word_length
    
    if current_chunk:
        chunks.append(' '.join(current_chunk))
    
    return chunks

def main():
    try:
        # Initialize ChatTTS
        logger.info("Initializing ChatTTS...")
        tts = Chat()
        
        # Try to use GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cpu":
            logger.warning("GPU not available, using CPU. This will be slower.")
        
        # Download and load models
        logger.info("Loading models...")
        tts.download_models()
        tts.load()
        
        # Get input text from stdin
        logger.info("Reading input text...")
        text = sys.stdin.read().strip()
        if not text:
            logger.error("No input text provided!")
            sys.exit(1)
        
        # Split text into chunks for faster processing
        chunks = chunk_text(text)
        total_chunks = len(chunks)
        logger.info(f"Processing {total_chunks} text chunks...")
        
        # Process each chunk
        audio_segments = []
        for i, chunk in enumerate(chunks, 1):
            logger.info(f"Generating speech for chunk {i}/{total_chunks}")
            audio = tts.infer(chunk)
            audio_segments.append(audio)
        
        # Combine audio segments
        combined_audio = np.concatenate(audio_segments)
        
        # Save the audio
        timestamp = int(time.time())
        output_filename = f"output_audio_{timestamp}.mp3"
        output_path = os.path.join("output", output_filename)
        
        if save_audio(combined_audio, output_path):
            logger.info(f"Speech generation complete! Audio saved to: {os.path.abspath(output_path)}")
            sys.exit(0)
        else:
            logger.error("Failed to save audio file")
            sys.exit(1)

    except KeyboardInterrupt:
        logger.error("Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error in main process: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 