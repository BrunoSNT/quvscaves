import axios, { AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { existsSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

let serverProcess: ReturnType<typeof spawn> | null = null;
const SERVER_URL = 'http://localhost:8000';
const MIN_TIMEOUT = 30000; // 30 seconds minimum

function estimateTimeout(text: string): number {
    // Rough estimate: 2 seconds per 15 characters, plus 10 seconds buffer
    const estimatedSeconds = Math.max(30, Math.ceil(text.length / 15) * 2) + 10;
    return estimatedSeconds * 1000; // Convert to milliseconds
}

// Start server immediately when module is loaded
startServer().catch(error => {
    logger.error('Failed to start TTS server:', error);
});

async function startServer(): Promise<void> {
    if (serverProcess) {
        return; // Server already started
    }

    logger.debug('Starting TTS server...');
    
    const ttsDir = join(process.cwd(), 'tts');
    const scriptPath = join(ttsDir, 'main.py');
    
    serverProcess = spawn('python3', [scriptPath], {
        cwd: ttsDir,
        env: {
            ...process.env,
            PYTHONPATH: ttsDir
        }
    });

    serverProcess.stdout?.on('data', (data) => {
        const message = data.toString();
        if (!message.includes('INFO:')) { // Don't log uvicorn INFO messages
            logger.debug('TTS Server:', message);
        }
    });

    serverProcess.stderr?.on('data', (data) => {
        const message = data.toString();
        if (message.includes('ERROR')) {
            logger.error('TTS Server Error:', message);
        } else {
            logger.debug('TTS Server:', message);
        }
    });

    // Wait for server to be ready
    for (let i = 0; i < 60; i++) { // 60 seconds timeout for initial startup
        try {
            const response = await axios.get(`${SERVER_URL}/health`);
            if (response.data.status === 'healthy') {
                logger.debug('TTS Server is ready');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 503) {
                // Server is starting up, wait
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    throw new Error('Failed to start TTS server');
}

export async function generateChatTTSAudio(text: string): Promise<string> {
    try {
        // Ensure server is running
        if (!serverProcess) {
            await startServer();
        }

        const timeout = estimateTimeout(text);
        logger.debug(`Using timeout of ${timeout}ms for text length ${text.length}`);

        // Generate temporary file path
        const timestamp = Date.now();
        const outputDir = join(process.cwd(), 'tts', 'output');
        const outputPath = join(outputDir, `output_audio_${timestamp}.mp3`);

        // Create output directory if it doesn't exist
        const { mkdir } = require('fs/promises');
        await mkdir(outputDir, { recursive: true });

        // Stream the response to file
        const response = await axios({
            method: 'post',
            url: `${SERVER_URL}/tts`,
            data: { text },
            responseType: 'stream',
            timeout: timeout
        });

        // Write stream to file
        const writer = require('fs').createWriteStream(outputPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        if (!existsSync(outputPath)) {
            throw new Error('Failed to save audio file');
        }

        const processingTime = response.headers['x-processing-time'];
        if (processingTime) {
            logger.debug(`Server processing time: ${processingTime}s`);
        }

        return outputPath;

    } catch (error) {
        if (error instanceof AxiosError) {
            if (error.code === 'ECONNABORTED') {
                logger.error('TTS request timed out:', {
                    textLength: text.length,
                    timeout: error.config?.timeout
                });
            } else {
                logger.error('Network error in generateChatTTSAudio:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
            }
        } else {
            logger.error('Error in generateChatTTSAudio:', error);
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