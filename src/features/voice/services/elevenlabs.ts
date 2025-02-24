import axios from 'axios';
import { VoiceService, VoiceConfig } from '../types';
import { logger, formatGenericOutput } from '../../../shared/logger';

export class ElevenLabsService implements VoiceService {
    private readonly API_URL = 'https://api.elevenlabs.io/v1';

    async speak(text: string, config: VoiceConfig): Promise<Buffer> {
        try {
            if (!config.ELEVENLABS_API_KEY) {
                throw new Error('ElevenLabs API key not configured');
            }

            const response = await axios.post(
                `${this.API_URL}/text-to-speech/pNInz6obpgDQGcFmaJgB`,
                {
                    text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.5,
                        speed: config.speed || 1.0
                    }
                },
                {
                    headers: {
                        'Accept': 'audio/mpeg',
                        'xi-api-key': config.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error) {
            logger.error('Error in ElevenLabs TTS:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async getVoices(): Promise<string[]> {
        // Implementation for getting available voices
        return ['pNInz6obpgDQGcFmaJgB']; // Default voice ID
    }

    async disconnect(): Promise<void> {
        // No persistent connection to clean up
    }
} 