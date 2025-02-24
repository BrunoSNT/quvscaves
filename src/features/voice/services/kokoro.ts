import { VoiceService, VoiceConfig } from '../types';
import { logger, formatGenericOutput } from '../../../shared/logger';
import axios from 'axios';

export class KokoroService implements VoiceService {
    private readonly API_URL = 'http://localhost:8001/tts';

    async speak(text: string, config: VoiceConfig): Promise<Buffer> {
        try {
            logger.info(`Sending TTS request to Kokoro server for language: ${config.language}`);
            
            // Get voice based on language
            const voice = this.getVoiceForLanguage(config.language);
            logger.info(`Selected voice: ${voice} for language: ${config.language}`);

            const response = await axios.post(
                this.API_URL,
                {
                    text,
                    voice,
                    speed: config.speed || 1.0
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'audio/mpeg'
                    },
                    responseType: 'arraybuffer'
                }
            );

            if (!response.data) {
                logger.error('Received empty response from Kokoro TTS server');
                return Buffer.from([]);
            }

            logger.info('Successfully received audio data from Kokoro TTS server');
            return Buffer.from(response.data);
        } catch (error) {
            logger.error('Error in Kokoro TTS:' + formatGenericOutput(JSON.stringify(error)));
            return Buffer.from([]); // Return empty buffer on error to avoid breaking the flow
        }
    }

    private getVoiceForLanguage(language: string): string {
        switch (language) {
            case 'pt-BR':
                return 'pm_alex'; // Default to male Portuguese voice
            case 'en-US':
            default:
                return 'af_heart'; // Default to female English voice
        }
    }

    async getVoices(): Promise<string[]> {
        return ['am_heart', 'af_heart', 'pm_alex', 'pf_clara'];
    }

    async disconnect(): Promise<void> {
        // No persistent connection to clean up
    }
} 