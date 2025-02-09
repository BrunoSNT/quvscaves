from ChatTTS import Chat
import logging
import os
import time
import numpy as np
from pydub import AudioSegment
from pydub.effects import normalize   # Added to enhance audio quality
import io
import sys

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
            frame_rate=24000,  # Original sample rate from ChatTTS
            sample_width=2,    # 16-bit = 2 bytes
            channels=1         # Mono
        )
        
        # Enhance audio quality:
        # 1. Normalize the audio to ensure consistent volume
        audio_segment = normalize(audio_segment)
        
        # 2. Upsample the audio to 44100 Hz for smoother playback
        audio_segment = audio_segment.set_frame_rate(44100)
        
        # Export as MP3 with a higher bitrate for better fidelity
        audio_segment.export(output_path, format="mp3", bitrate="192k")
        logging.info(f"Enhanced audio saved successfully to {output_path}")
    except Exception as e:
        logging.error(f"Error saving audio: {str(e)}")
        raise

def main():
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    try:
        # Initialize ChatTTS
        logger.info("Initializing ChatTTS...")
        tts = Chat()

        # Download and load models if needed
        logger.info("Downloading and loading models...")
        tts.download_models()
        tts.load()

        # Create output directory if it doesn't exist
        output_dir = "output"
        os.makedirs(output_dir, exist_ok=True)

        # Get input text
        if len(sys.argv) > 1:
            # Read from file if provided
            with open(sys.argv[1], 'r') as f:
                text = f.read().strip()
        else:
            # Read from stdin
            text = sys.stdin.read().strip()

        if not text:
            logger.error("No input text provided!")
            sys.exit(1)

        # Generate speech
        logger.info(f"Generating speech for text: {text}")
        try:
            # Generate the audio using the ChatTTS infer method
            audio = tts.infer(text)
            
            # Create output filename
            timestamp = int(time.time())
            output_filename = f"output_audio_{timestamp}.mp3"
            output_path = os.path.join(output_dir, output_filename)
            
            # Save the enhanced audio
            save_audio(audio, output_path)
            logger.info(f"Speech generation complete! Audio saved to: {os.path.abspath(output_path)}")
            
        except Exception as e:
            logger.error(f"Error generating speech: {str(e)}")
            sys.exit(1)

    except Exception as e:
        logger.error(f"Error in main process: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 