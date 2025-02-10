import axios, { AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { existsSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

let serverProcess: ReturnType<typeof spawn> | null = null;
const SERVER_URL = 'http://localhost:8000';
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second

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
    portuguese: ['pm_adam', 'pf_heart', 'pm_soul', 'pf_soul']
} as const;

interface TTSOptions {
    engine?: TTSEngine;
    voice?: string;
    speed?: number;
}

async function startServer(): Promise<boolean> {
    try {
        // Check if server is already running
        try {
            const response = await axios.get(`${SERVER_URL}/health`);
            if (response.data.status === 'healthy') {
                logger.info('TTS Server is already running');
                return true;
            }
        } catch (error) {
            // Server is not running, continue with startup
        }

        logger.info('Starting TTS Server...');
        const pythonPath = process.env.PYTHON_PATH || 'python3';
        const scriptPath = join(process.cwd(), 'tts', 'main.py');

        if (!existsSync(scriptPath)) {
            logger.error('TTS Server script not found:', scriptPath);
            return false;
        }

        serverProcess = spawn(pythonPath, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        serverProcess.stdout?.on('data', (data) => {
            logger.debug('TTS Server:', data.toString());
        });

        serverProcess.stderr?.on('data', (data) => {
            logger.error('TTS Server Error:', data.toString());
        });

        // Wait for server to start
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                const response = await axios.get(`${SERVER_URL}/health`);
                if (response.data.status === 'healthy') {
                    logger.info('TTS Server started successfully');
                    return true;
                }
            } catch (error) {
                if (i === MAX_RETRIES - 1) {
                    logger.error('Failed to start TTS server after retries');
                    return false;
                }
            }
        }

        return false;
    } catch (error) {
        logger.error('Failed to start TTS server:', error);
        return false;
    }
}

export async function generateTTSAudio(text: string, options: TTSOptions = {}): Promise<string> {
    try {
        // Ensure server is running
        const serverStarted = await startServer();
        if (!serverStarted) {
            throw new Error('Failed to start TTS server');
        }

        // Generate temporary file path
        const timestamp = Date.now();
        const outputDir = join(process.cwd(), 'tts', 'output');
        const outputPath = join(outputDir, `output_audio_${timestamp}.wav`);

        // Create output directory if it doesn't exist
        const { mkdir } = require('fs/promises');
        await mkdir(outputDir, { recursive: true });

        // Request audio generation with options, always using kokoro
        const response = await axios({
            method: 'post',
            url: `${SERVER_URL}/tts`,
            data: {
                text,
                engine: 'kokoro',
                voice: options.voice || 'af_heart',
                speed: options.speed || 1.0
            },
            responseType: 'arraybuffer',
            headers: {
                'Accept': 'audio/wav'
            }
        });

        // Save the audio file
        writeFileSync(outputPath, response.data);

        if (!existsSync(outputPath)) {
            throw new Error('Failed to save audio file');
        }

        return outputPath;

    } catch (error) {
        if (error instanceof AxiosError) {
            logger.error('Network error in generateTTSAudio:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
        } else {
            logger.error('Error in generateTTSAudio:', error);
        }
        throw error;
    }
}

// Clean up server on process exit
process.on('exit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
}); 