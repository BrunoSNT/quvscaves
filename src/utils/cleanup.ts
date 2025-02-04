import { unlink, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';

const AUDIO_DIR = join(process.cwd(), 'audios');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cleanupOldAudioFiles(): Promise<void> {
    try {
        const now = Date.now();
        const entries = await readdir(AUDIO_DIR);

        for (const entry of entries) {
            // Skip .DS_Store and other hidden files
            if (entry.startsWith('.')) {
                continue;
            }

            const entryPath = join(AUDIO_DIR, entry);
            try {
                // Check if it's a directory
                const stats = await stat(entryPath);
                if (!stats.isDirectory()) {
                    continue;
                }

                const files = await readdir(entryPath);

                for (const file of files) {
                    if (file.startsWith('.')) continue; // Skip hidden files
                    
                    const filePath = join(entryPath, file);
                    try {
                        const timestamp = parseInt(file.split('.')[0]);
                        if (!isNaN(timestamp) && now - timestamp > MAX_AGE_MS) {
                            await unlink(filePath);
                            logger.debug(`Deleted old audio file: ${filePath}`);
                        }
                    } catch (error) {
                        logger.error(`Error processing file ${filePath}:`, error);
                    }
                }
            } catch (error) {
                logger.error(`Error processing entry ${entryPath}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error cleaning up audio files:', error);
    }
}

export async function cleanupAdventureAudios(adventureId: string): Promise<void> {
    try {
        const adventurePath = join(AUDIO_DIR, adventureId);
        const files = await readdir(adventurePath);

        for (const file of files) {
            try {
                await unlink(join(adventurePath, file));
            } catch (error) {
                logger.error(`Error deleting file ${file}:`, error);
            }
        }

        logger.info(`Cleaned up audio files for adventure ${adventureId}`);
    } catch (error) {
        logger.error(`Error cleaning up adventure ${adventureId} audio files:`, error);
    }
} 