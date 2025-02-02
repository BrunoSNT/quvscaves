import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource,
} from '@discordjs/voice';
import axios from 'axios';
import { Guild } from 'discord.js';

export async function speakInVoiceChannel(
    text: string, 
    channelId: string, 
    guild: Guild
) {
    try {
        const connection = joinVoiceChannel({
            channelId,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator
        });

        // Convert text to speech using ElevenLabs
        const audioResponse = await axios.post(
            'https://api.elevenlabs.io/v1/text-to-speech/voice-id',
            { text },
            {
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY
                },
                responseType: 'arraybuffer'
            }
        );

        const player = createAudioPlayer();
        const resource = createAudioResource(audioResponse.data);

        connection.subscribe(player);
        player.play(resource);

    } catch (error) {
        console.error('Error in voice playback:', error);
    }
} 