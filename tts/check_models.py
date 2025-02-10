import os
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

REQUIRED_FILES = [
    'asset/Decoder.safetensors',
    'asset/DVAE.safetensors',
    'asset/Embed.safetensors',
    'asset/Vocos.safetensors',
    'asset/gpt/config.json',
    'asset/gpt/model.safetensors'
]

def check_models():
    """Check if all required model files are present and have expected sizes."""
    logger.info("Checking TTS model files...")
    
    base_dir = Path(__file__).parent
    missing_files = []
    
    for file_path in REQUIRED_FILES:
        full_path = base_dir / file_path
        if not full_path.exists():
            missing_files.append(file_path)
            logger.warning(f"Missing file: {file_path}")
        else:
            size_mb = full_path.stat().st_size / (1024 * 1024)
            logger.info(f"Found {file_path} ({size_mb:.1f}MB)")
    
    if missing_files:
        logger.error("Some model files are missing. Please run download_models.py first.")
        return False
    
    logger.info("✅ All model files are present")
    return True

if __name__ == "__main__":
    success = check_models()
    exit(0 if success else 1) 