"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.speakInVoiceChannel = speakInVoiceChannel;
const voice_1 = require("@discordjs/voice");
const axios_1 = __importDefault(require("axios"));
async function speakInVoiceChannel(text, channelId, guild) {
    try {
        const connection = (0, voice_1.joinVoiceChannel)({
            channelId,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator
        });
        // Convert text to speech using ElevenLabs
        const audioResponse = await axios_1.default.post('https://api.elevenlabs.io/v1/text-to-speech/voice-id', { text }, {
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            responseType: 'arraybuffer'
        });
        const player = (0, voice_1.createAudioPlayer)();
        const resource = (0, voice_1.createAudioResource)(audioResponse.data);
        connection.subscribe(player);
        player.play(resource);
    }
    catch (error) {
        console.error('Error in voice playback:', error);
    }
}
