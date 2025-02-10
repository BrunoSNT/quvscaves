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

// Helper function to create a voice channel
async function createVoiceChannel(guild: Guild, categoryId: string, channelName: string): Promise<VoiceChannel> {
    const category = await guild.channels.fetch(categoryId) as CategoryChannel;
    if (!category) {
        throw new Error('Category not found');
    }

    return await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: category
    }) as VoiceChannel;
}

export async function speakInVoiceChannel(
    text: string,
    guild: Guild,
    categoryId: string,
    adventureId: string,
    voiceType: 'elevenlabs' | 'chattts' = 'chattts'
) {
    let connection: VoiceConnection | null = null;
    let audioPath: string | null = null;
    let player: AudioPlayer | null = null;

    try {
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

        // Generate audio
        audioPath = await generateChatTTSAudio(text);
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
        await new Promise((resolve) => {
            player!.on(AudioPlayerStatus.Playing, () => {
                logger.debug('Audio playback started');
            });

            player!.on(AudioPlayerStatus.Idle, () => {
                resolve(true);
            });
        });

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