import { spawn } from 'child_process';
import { join } from 'path';
import { logger } from '../../utils/logger';
import { existsSync, mkdirSync } from 'fs';

export async function generateChatTTSAudio(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            logger.debug('Starting ChatTTS generation with text length:', text.length);
            
            // Get the absolute paths
            const ttsDir = join(process.cwd(), 'tts');
            const scriptPath = join(ttsDir, 'run_tts.py');
            const outputDir = join(ttsDir, 'output');
            
            // Create output directory if it doesn't exist
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
            }

            // Spawn the TTS script
            const ttsProcess = spawn('python3', [scriptPath], {
                cwd: ttsDir,
                env: {
                    ...process.env,
                    PYTHONPATH: ttsDir
                }
            });

            let outputPath = '';
            let errorOutput = '';

            // Send the text to the script's stdin
            ttsProcess.stdin.write(text);
            ttsProcess.stdin.end();

            // Collect output path from stdout
            ttsProcess.stdout.on('data', (data) => {
                const output = data.toString();
                logger.debug('ChatTTS stdout:', output);
                
                // Look for the output path
                const match = output.match(/Audio saved to: (.+\.mp3)/);
                if (match) {
                    outputPath = match[1].trim();
                    logger.debug('Found output path:', outputPath);
                }
            });

            // Collect error output
            ttsProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                logger.error('ChatTTS stderr:', data.toString());
            });

            // Handle process completion
            ttsProcess.on('close', (code) => {
                if (code !== 0) {
                    logger.error('ChatTTS process exited with code:', code);
                    logger.error('Error output:', errorOutput);
                    reject(new Error(`ChatTTS process failed with code ${code}: ${errorOutput}`));
                    return;
                }

                if (!outputPath) {
                    reject(new Error('No output path found in ChatTTS output'));
                    return;
                }

                // Ensure the path is absolute
                const absolutePath = outputPath.startsWith('/') ? outputPath : join(ttsDir, outputPath);
                
                // Add a small delay to ensure file is written
                setTimeout(() => {
                    if (existsSync(absolutePath)) {
                        logger.debug('Audio file exists at:', absolutePath);
                        resolve(absolutePath);
                    } else {
                        logger.error('Audio file not found at:', absolutePath);
                        reject(new Error('Generated audio file not found'));
                    }
                }, 100);
            });

            // Handle process errors
            ttsProcess.on('error', (error) => {
                logger.error('Error spawning ChatTTS process:', error);
                reject(error);
            });

        } catch (error) {
            logger.error('Error in generateChatTTSAudio:', error);
            reject(error);
        }
    });
} 