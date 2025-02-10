import {
    AudioPlayer,
    AudioPlayerStatus,
    AudioResource,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    joinVoiceChannel,
    StreamType,
    VoiceConnection,
    NoSubscriberBehavior
} from '@discordjs/voice';
import { Guild, VoiceChannel, ChannelType, CategoryChannel } from 'discord.js';
import { Readable } from 'stream';
import { logger } from '../utils/logger';
import axios from 'axios';
import { generateChatTTSAudio } from './voice/chattts';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { VoiceType, KokoroVoice } from '../types/game';

// Keep track of active connections and players
const activeConnections = new Map<string, VoiceConnection>();
const activePlayers = new Map<string, AudioPlayer>();

const DISCONNECT_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// Function to get audio from ElevenLabs
async function getAudioFromElevenLabs(text: string): Promise<Buffer | null> {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            logger.warn('No ElevenLabs API key found in environment variables');
            return null;
        }

        const response = await axios.post(
            'https://api.elevenlabs.io/v1/text-to-speech/NFG5qt843uXKj4pFvR7C',
            {
                text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            },
            {
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey
                },
                responseType: 'arraybuffer'
            }
        );

        return Buffer.from(response.data);
    } catch (error) {
        logger.error('Error getting audio from ElevenLabs:', error);
        return null;
    }
}

// Helper function to determine Kokoro voice based on language
function getKokoroVoiceForLanguage(language: string): KokoroVoice {
    switch (language.toLowerCase()) {
        case 'pt-br':
            return 'pf_heart';
        case 'es':
            return 'ef_heart';
        case 'fr':
            return 'ff_heart';
        case 'ja':
            return 'jf_heart';
        case 'zh':
            return 'zf_heart';
        case 'hi':
            return 'hf_heart';
        case 'it':
            return 'if_heart';
        default:
            return 'af_heart'; // Default to English
    }
}

// Function to ensure TTS server is running
async function ensureTTSServerRunning(): Promise<boolean> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // 2 seconds

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            logger.debug(`Attempting to connect to TTS server (attempt ${i + 1}/${MAX_RETRIES})...`);
            const response = await axios.get('http://localhost:8000/health');
            if (response.data.status === 'healthy') {
                logger.debug('TTS server is healthy');
                return true;
            }
        } catch (error) {
            if (i === MAX_RETRIES - 1) {
                logger.error('Failed to connect to TTS server after all retries');
                throw error;
            }
            logger.debug(`TTS server not ready, retrying in ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
    return false;
}

export async function speakInVoiceChannel(
    text: string,
    guild: Guild,
    categoryId: string,
    adventureId: string,
    voiceType: VoiceType = 'kokoro',
    language: string = 'en-US'
) {
    let connection: VoiceConnection | null = null;
    let audioPath: string | null = null;
    let player: AudioPlayer | null = null;

    try {
        // Check if TTS server is running
        const serverRunning = await ensureTTSServerRunning();
        if (!serverRunning) {
            throw new Error('TTS server is not running');
        }

        // Find the Table voice channel
        const category = await guild.channels.fetch(categoryId) as CategoryChannel | null;
        if (!category) {
            throw new Error('Adventure category not found');
        }

        const channels = await guild.channels.fetch();
        const tableChannel = channels.find(
            channel =>
                channel?.parentId === categoryId &&
                channel?.name.toLowerCase() === 'table' &&
                channel?.type === ChannelType.GuildVoice
        ) as VoiceChannel | undefined;

        if (!tableChannel) {
            throw new Error('Table voice channel not found');
        }

        // Join voice channel
        connection = joinVoiceChannel({
            channelId: tableChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        // Create and set up audio player
        player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 50
            }
        });
        
        connection.subscribe(player);

        logger.debug(`Generating audio with voice type: ${voiceType}`);

        // Generate audio based on voice type
        switch (voiceType) {
            case 'elevenlabs': {
                const audioBuffer = await getAudioFromElevenLabs(text);
                if (!audioBuffer) {
                    throw new Error('Failed to generate audio with ElevenLabs');
                }
                
                // Save buffer to temporary file
                const timestamp = Date.now();
                audioPath = join(process.cwd(), 'tts', 'output', `elevenlabs_${timestamp}.mp3`);
                await require('fs/promises').writeFile(audioPath, audioBuffer);
                break;
            }
            
            case 'kokoro': {
                // Use Kokoro with language-appropriate voice
                const kokoroVoice = getKokoroVoiceForLanguage(language);
                logger.debug(`Using Kokoro voice: ${kokoroVoice} for language: ${language}`);
                audioPath = await generateChatTTSAudio(text, {
                    engine: 'kokoro',
                    voice: kokoroVoice,
                    speed: 1.0
                });
                break;
            }
            
            default:
                logger.warn(`Unsupported voice type: ${voiceType}, falling back to Kokoro`);
                const kokoroVoice = getKokoroVoiceForLanguage(language);
                audioPath = await generateChatTTSAudio(text, {
                    engine: 'kokoro',
                    voice: kokoroVoice,
                    speed: 1.0
                });
                break;
        }

        if (!audioPath || !existsSync(audioPath)) {
            throw new Error('Failed to generate audio file');
        }

        // Play audio
        const resource = createAudioResource(audioPath, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        if (resource.volume) {
            resource.volume.setVolume(1.0);
        }

        player.play(resource);

        // Wait for playback to complete
        await new Promise((resolve, reject) => {
            player!.on(AudioPlayerStatus.Playing, () => {
                logger.debug('Audio playback started');
            });

            player!.on(AudioPlayerStatus.Idle, () => {
                resolve(true);
            });

            player!.on('error', (error) => {
                logger.error('Audio playback error:', error);
                reject(error);
            });
        });

        // Clean up audio file after playback
        try {
            await unlink(audioPath);
        } catch (error) {
            logger.error('Error cleaning up audio file:', error);
        }

        // Set disconnect timer
        if (disconnectTimers.has(adventureId)) {
            clearTimeout(disconnectTimers.get(adventureId)!);
        }

        disconnectTimers.set(adventureId, setTimeout(() => {
            const conn = getVoiceConnection(guild.id);
            if (conn) {
                conn.destroy();
                disconnectTimers.delete(adventureId);
            }
        }, DISCONNECT_TIMEOUT));

    } catch (error) {
        // Clean up on error
        if (audioPath && existsSync(audioPath)) {
            try {
                await unlink(audioPath);
            } catch (cleanupError) {
                logger.error('Error cleaning up audio file:', cleanupError);
            }
        }

        if (player) {
            player.stop();
        }

        if (connection) {
            connection.destroy();
        }

        throw error;
    }
}

export function disconnectFromVoice(guildId: string) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
    }
} 