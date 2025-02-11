import {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    joinVoiceChannel,
    StreamType,
    VoiceConnection,
    NoSubscriberBehavior
} from '@discordjs/voice';
import { Guild, VoiceChannel, ChannelType, CategoryChannel, TextChannel } from 'discord.js';
import { logger } from '../utils/logger';
import axios from 'axios';
import { generateTTSAudio, ttsEvents } from './voice/tts';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { sendFormattedResponse } from '../utils/discord/embeds';

// Create event emitter for voice events
export const voiceEvents = new EventEmitter();

const DISCONNECT_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// Store active voice sessions
const activeSessions = new Map<string, {
    channel: TextChannel;
    characterName: string;
    action: string;
}>();

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

export async function speakInVoiceChannel(
    text: string,
    guild: Guild,
    categoryId: string,
    adventureId: string,
    language: string = 'en-US',
    channel?: TextChannel,
    characterName?: string,
    action?: string
) {
    let audioPath: string | null = null;
    let connection: VoiceConnection | null = null;

    try {
        // Store session information if provided
        if (channel && characterName && action) {
            activeSessions.set(guild.id, {
                channel,
                characterName,
                action
            });
        }

        // Listen for TTS events
        ttsEvents.once('ttsStarted', async ({ text: ttsText }) => {
            const session = activeSessions.get(guild.id);
            if (session && session.channel) {
                // Just emit the event, don't send embed
                voiceEvents.emit('playbackStarted', adventureId);
            }
        });

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

        // Create audio player
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        connection.subscribe(player);

        // Generate audio
        audioPath = await generateTTSAudio(text, {
            voice: language === 'pt-BR' ? 'pm_santa' : 'bm_lewis',
            speed: 1.0
        });

        // Create and play audio resource
        const resource = createAudioResource(audioPath, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        if (resource.volume) {
            resource.volume.setVolume(1.0);
        }

        // Play audio and wait for completion
        player.play(resource);
        await new Promise((resolve, reject) => {
            player.on(AudioPlayerStatus.Playing, () => {
                logger.debug('Audio playback started');
                voiceEvents.emit('playbackStarted', adventureId);
            });

            player.on(AudioPlayerStatus.Idle, () => {
                logger.debug('Audio playback completed');
                resolve(null);
            });

            player.on('error', (error) => {
                logger.error('Error playing audio:', error);
                reject(error);
            });
        });

        // Set disconnect timer
        if (disconnectTimers.has(adventureId)) {
            clearTimeout(disconnectTimers.get(adventureId)!);
        }

        disconnectTimers.set(adventureId, setTimeout(() => {
            connection?.destroy();
            disconnectTimers.delete(adventureId);
        }, DISCONNECT_TIMEOUT));

    } catch (error) {
        logger.error('Error in speakInVoiceChannel:', error);
        throw error;
    } finally {
        // Clean up audio file
        if (audioPath && existsSync(audioPath)) {
            try {
                await unlink(audioPath);
            } catch (error) {
                logger.error('Error cleaning up audio file:', error);
            }
        }
    }
}

export function disconnectFromVoice(guildId: string) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
    }
} 