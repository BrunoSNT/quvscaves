export type VoiceProvider = 'ELEVENLABS' | 'KOKORO' | 'NONE' | 'DISCORD';

export interface VoiceConfig {
    provider: VoiceProvider;
    language: string;
    ELEVENLABS_API_KEY?: string;
    speed?: number;
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