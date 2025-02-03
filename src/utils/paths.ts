import { join } from 'path';
import { mkdirSync } from 'fs';

export function getAudioPath(adventureId: string, timestamp: number): string {
    // Create base audio directory if it doesn't exist
    const baseDir = join(process.cwd(), 'audios');
    mkdirSync(baseDir, { recursive: true });

    // Create adventure-specific directory if it doesn't exist
    const adventureDir = join(baseDir, adventureId);
    mkdirSync(adventureDir, { recursive: true });

    // Return full path for the audio file
    return join(adventureDir, `${timestamp}.mp3`);
} 