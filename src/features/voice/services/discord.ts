import { VoiceService, VoiceConfig } from '../types';
import { logger } from '../../../shared/logger';
import axios from 'axios';

export class DiscordService implements VoiceService {
    private readonly TTS_SERVER_URL = 'http://localhost:8000';

    async speak(text: string, config: VoiceConfig): Promise<Buffer> {
        try {
            logger.debug('Sending TTS request to local server:', {
                text,
                language: config.language
            });

            const voice = config.language === 'en-US' ? 'af_heart' : 'pm_alex';
            
            const response = await axios.post(
                `${this.TTS_SERVER_URL}/tts`,
                {
                    text,
                    voice,
                    speed: config.speed || 1.0
                },
                {
                    responseType: 'arraybuffer',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'audio/wav'
                    }
                }
            );

            return Buffer.from(response.data);
        } catch (error) {
            logger.error('Error in Discord TTS:', error);
            throw error;
        }
    }

    async getVoices(): Promise<string[]> {
        return ['af_heart', 'pm_alex'];
    }

    async disconnect(): Promise<void> {
        // No persistent connection to clean up
    }
} 