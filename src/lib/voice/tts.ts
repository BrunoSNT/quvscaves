import axios, { AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { existsSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { EventEmitter } from 'events';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';

const SERVER_URL = 'http://localhost:8000';

// Voice engine types
export type TTSEngine = 'kokoro';

// Kokoro voice options
export const KOKORO_VOICES = {
    english: ['am_adam', 'af_heart', 'af_soul', 'af_mind', 'af_spirit'],
    spanish: ['ef_heart', 'ef_soul'],
    french: ['ff_heart', 'ff_soul'],
    japanese: ['jf_heart', 'jf_soul'],
    chinese: ['zf_heart', 'zf_soul'],
    hindi: ['hf_heart', 'hf_soul'],
    italian: ['if_heart', 'if_soul'],
    portuguese: ['pm_alex', 'pf_dora', 'pm_santa',]
} as const;

export const ttsEvents = new EventEmitter();

export interface TTSOptions {
    voice?: string;
    speed?: number;
}

export async function generateTTSAudio(text: string, options: TTSOptions = {}): Promise<string> {
    try {
        // Generate temporary file path
        const timestamp = Date.now();
        const outputDir = join(process.cwd(), 'tts', 'output');
        const outputPath = join(outputDir, `output_${timestamp}.wav`);

        // Create output directory if it doesn't exist
        await mkdir(outputDir, { recursive: true });

        // Request audio generation
        const response = await axios.post(
            `${SERVER_URL}/tts`,
            {
                text,
                voice: options.voice || 'af_heart',
                speed: options.speed || 1.0
            },
            {
                responseType: 'arraybuffer'
            }
        );

        // Save the audio file
        await writeFile(outputPath, response.data);
        return outputPath;

    } catch (error) {
        logger.error('Error in generateTTSAudio:', error);
        throw error;
    }
}