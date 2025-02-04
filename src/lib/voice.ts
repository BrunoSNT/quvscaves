import {
    AudioPlayer,
    AudioPlayerStatus,
    AudioResource,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    joinVoiceChannel,
    StreamType,
    VoiceConnection
} from '@discordjs/voice';
import { Guild, VoiceChannel, CategoryChannel, Snowflake as DiscordChannelType } from 'discord.js';
import { createReadStream } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { logger } from '../utils/logger';
import axios from 'axios';

// Keep track of active connections and players
const activeConnections = new Map<string, VoiceConnection>();
const activePlayers = new Map<string, AudioPlayer>();

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
        type: DiscordChannelType.GuildVoice,
        parent: category
    }) as VoiceChannel;
}

export async function speakInVoiceChannel(
    text: string,
    guild: Guild,
    categoryId: string,
    adventureId: string
): Promise<void> {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            logger.warn('No ElevenLabs API key found in environment variables');
            return;
        }

        logger.debug('Starting voice generation with params:', {
            guildId: guild.id,
            categoryId,
            adventureId,
            textLength: text.length
        });

        const voiceChannelName = `${adventureId}-voice`;
        let voiceChannel = guild.channels.cache.find(
            (channel): channel is VoiceChannel =>
                channel.name === voiceChannelName &&
                channel.type === DiscordChannelType.GuildVoice
        );

        if (!voiceChannel) {
            logger.debug('Voice channel not found, creating new one');
            voiceChannel = await createVoiceChannel(guild, categoryId, voiceChannelName);
        }

        // Safety check
        if (!voiceChannel) {
            logger.error('Failed to create or find voice channel');
            return;
        }

        logger.debug('Getting audio from ElevenLabs');
        const audioBuffer = await getAudioFromElevenLabs(text).catch(error => {
            if (axios.isAxiosError(error)) {
                logger.error('ElevenLabs API error:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    message: error.message
                });
            } else {
                logger.error('Error getting audio from ElevenLabs:', error);
            }
            return null;
        });

        if (!audioBuffer) {
            logger.warn('No audio generated, skipping voice playback');
            return;
        }

        logger.debug('Joining voice channel');
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        // Store the active connection and player
        activeConnections.set(guild.id, connection);
        activePlayers.set(guild.id, player);

        logger.debug('Creating audio resource');
        const resource = createAudioResource(Readable.from(audioBuffer));
        
        // Add state change logging
        player.on(AudioPlayerStatus.Playing, () => {
            logger.debug('Audio player started playing');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            logger.debug('Audio player finished playing');
            // Cleanup after playback
            activePlayers.delete(guild.id);
            connection.destroy();
            activeConnections.delete(guild.id);
        });

        // Handle connection errors
        connection.on('error', error => {
            logger.error('Error in voice connection:', {
                error: error.message,
                name: error.name,
                stack: error.stack
            });
            activeConnections.delete(guild.id);
            activePlayers.delete(guild.id);
        });

        // Handle player errors
        player.on('error', error => {
            logger.error('Error in audio player:', {
                error: error.message,
                name: error.name,
                stack: error.stack
            });
            activePlayers.delete(guild.id);
        });

        logger.debug('Starting playback');
        player.play(resource);

    } catch (error) {
        if (error instanceof Error) {
            logger.error('Error in voice playback:', {
                error: error.message,
                name: error.name,
                stack: error.stack
            });
        } else {
            logger.error('Unknown error in voice playback:', error);
        }
        // Don't throw the error up - just log it and continue
    }
}

// Add a function to manually disconnect
export function disconnectVoice(guildId: string) {
    const connection = activeConnections.get(guildId);
    const player = activePlayers.get(guildId);
    
    if (player) {
        player.stop();
        activePlayers.delete(guildId);
    }
    
    if (connection) {
        connection.destroy();
        activeConnections.delete(guildId);
    }
} 