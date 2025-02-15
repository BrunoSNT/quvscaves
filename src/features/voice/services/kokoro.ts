import { VoiceService, VoiceConfig } from '../types';
import { logger } from '../../../shared/logger';
import axios from 'axios';

export class KokoroService implements VoiceService {
    private readonly API_URL = 'https://api.kokoro.ai/v1/tts';

    async speak(text: string, config: VoiceConfig): Promise<Buffer> {
        try {
            if (!config.apiKey) {
                throw new Error('Kokoro API key not configured');
            }

            const response = await axios.post(
                this.API_URL,
                {
                    text,
                    voice_id: config.voiceId || 'default',
                    language: config.language,
                    speed: config.speed || 1.0
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.apiKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'audio/mpeg'
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error) {
            logger.error('Error in Kokoro TTS:', error);
            throw error;
        }
    }

    async getVoices(): Promise<string[]> {
        return ['default'];
    }

    async disconnect(): Promise<void> {
        // No persistent connection to clean up
    }
} 