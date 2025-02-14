export type VoiceProvider = 'ELEVENLABS' | 'DISCORD' | 'KOKORO' | 'NONE';

export interface VoiceConfig {
    provider: 'ELEVENLABS' | 'KOKORO' | 'DISCORD';
    voiceId?: string;
    apiKey?: string;
    speed?: number;
    ELEVENLABS_API_KEY?: string;
    language: string;
}

export interface VoiceService {
    speak(text: string, config: VoiceConfig): Promise<Buffer>;
    getVoices(): Promise<string[]>;
    disconnect(): Promise<void>;
}

export interface VoiceConnection {
    channelId: string;
    guildId: string;
    status: 'CONNECTED' | 'DISCONNECTED' | 'SPEAKING';
} 