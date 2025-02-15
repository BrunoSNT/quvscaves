import { VoiceService, VoiceProvider } from '../types';
import { ElevenLabsService } from './elevenlabs';
import { DiscordService } from './discord';
import { KokoroService } from './kokoro';

const services: Record<VoiceProvider, VoiceService> = {
    'ELEVENLABS': new ElevenLabsService(),
    'DISCORD': new DiscordService(),
    'KOKORO': new KokoroService(),
    'NONE': {
        speak: async () => Buffer.from([]),
        getVoices: async () => [],
        disconnect: async () => {}
    }
};

export async function getVoiceService(provider: VoiceProvider): Promise<VoiceService> {
    return services[provider] || services['NONE'];
} 