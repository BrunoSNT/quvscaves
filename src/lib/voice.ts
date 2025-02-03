import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource,
    VoiceConnection,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus,
    StreamType
} from '@discordjs/voice';
import { Guild } from 'discord.js';
import { createReadStream } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { writeFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

// Ensure audio directories exist
const audioDir = join(process.cwd(), 'audios');
mkdirSync(audioDir, { recursive: true });

// Keep track of connections per guild
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, any>();

const execAsync = promisify(exec);

async function getAudioFromElevenLabs(text: string, adventureId: string): Promise<string> {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            throw new Error('ELEVENLABS_API_KEY not found');
        }

        console.log('Requesting audio from ElevenLabs...');
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
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );

        // Create adventure directory if it doesn't exist
        const adventureDir = join(audioDir, adventureId);
        mkdirSync(adventureDir, { recursive: true });

        // Save audio file
        const timestamp = Date.now();
        const audioPath = join(adventureDir, `${timestamp}.mp3`);
        await writeFile(audioPath, Buffer.from(response.data));
        
        console.log('Audio saved to:', audioPath);
        return audioPath;

    } catch (error) {
        console.error('Error getting audio from ElevenLabs:', error);
        throw error;
    }
}

async function speedupAudio(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace('.mp3', '_fast.mp3');
    await execAsync(`ffmpeg -i ${inputPath} -filter:a "atempo=1.5" ${outputPath}`);
    return outputPath;
}

async function getOrCreateConnection(guild: Guild, categoryId: string): Promise<VoiceConnection> {
    // Check if we already have a connection
    let connection = connections.get(guild.id);
    
    // If no connection exists or it's destroyed, create a new one
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
        // Find the Table channel
        const voiceChannel = guild.channels.cache.find(
            channel => channel.name === 'Table' && 
            channel.parentId === categoryId && 
            channel.isVoiceBased()
        );

        if (!voiceChannel) {
            throw new Error('Voice channel not found');
        }

        console.log('Found voice channel:', voiceChannel.id);

        // Create new connection
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        // Store the connection
        connections.set(guild.id, connection);

        // Wait for the connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 5000);
        console.log('Voice connection ready');

        // Handle disconnection
        connection.on('stateChange', (oldState, newState) => {
            console.log(`Connection state changed from ${oldState.status} to ${newState.status}`);
            if (newState.status === VoiceConnectionStatus.Disconnected) {
                connections.delete(guild.id);
                players.delete(guild.id);
            }
        });
    }

    return connection;
}

export async function speakInVoiceChannel(text: string, guild: Guild, categoryId: string, adventureId: string) {
    try {
        console.log('Starting voice playback process...');

        // Get audio from ElevenLabs and save it
        const audioPath = await getAudioFromElevenLabs(text, adventureId);
        const fastAudioPath = await speedupAudio(audioPath);

        // Get or create connection
        const connection = await getOrCreateConnection(guild, categoryId);

        // Get or create player
        let player = players.get(guild.id);
        if (!player) {
            player = createAudioPlayer();
            players.set(guild.id, player);
            connection.subscribe(player);
        }

        console.log('Loading audio from:', fastAudioPath);

        const resource = createAudioResource(createReadStream(fastAudioPath), {
            inlineVolume: true
        });

        // Set volume to maximum
        if (resource.volume) {
            resource.volume.setVolume(1);
        }

        // Play audio
        player.play(resource);
        console.log('Playing audio at 1.5x speed...');

        // Wait for playback to finish
        await new Promise((resolve, reject) => {
            const onPlaying = () => {
                console.log('Audio is now playing');
            };

            const onIdle = () => {
                console.log('Playback finished');
                cleanup();
                resolve(true);
            };

            const onError = (error: Error) => {
                console.error('Error playing audio:', error);
                cleanup();
                reject(error);
            };

            const cleanup = () => {
                player.off(AudioPlayerStatus.Playing, onPlaying);
                player.off(AudioPlayerStatus.Idle, onIdle);
                player.off('error', onError);
            };

            player.on(AudioPlayerStatus.Playing, onPlaying);
            player.on(AudioPlayerStatus.Idle, onIdle);
            player.on('error', onError);
        });

    } catch (error) {
        console.error('Error in voice playback:', error);
    }
}

// Add a function to manually disconnect
export function disconnectVoice(guildId: string) {
    const connection = connections.get(guildId);
    if (connection) {
        connection.destroy();
        connections.delete(guildId);
        players.delete(guildId);
    }
} 