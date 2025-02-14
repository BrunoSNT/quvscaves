import { VoiceProvider } from '../types';

export interface VoiceProviderConfig {
    provider: VoiceProvider;
    apiKey?: string;
    voiceId?: string;
    defaultLanguage: string;
    defaultSpeed: number;
}

export const voiceConfig: Record<VoiceProvider, VoiceProviderConfig> = {
    ELEVENLABS: {
        provider: 'ELEVENLABS',
        defaultLanguage: 'en-US',
        defaultSpeed: 1.0
    },
    DISCORD: {
        provider: 'DISCORD',
        defaultLanguage: 'en-US',
        defaultSpeed: 1.0
    },
    KOKORO: {
        provider: 'KOKORO',
        defaultLanguage: 'ja-JP',
        defaultSpeed: 1.0
    },
    NONE: {
        provider: 'NONE',
        defaultLanguage: 'en-US',
        defaultSpeed: 1.0
    }
}; 

export const KOKORO_VOICES_BY_LANGUAGE = {
    'en-US': [
      { label: 'Voice 1', value: 'voice_1' }
    ],
    'pt-BR': [
      { label: 'Voz 1', value: 'voz_1' }
    ]
  };
  
  export const VOICE_DESCRIPTIONS = {
    none: 'No voice',
    discord: 'Discord TTS',
    elevenlabs: 'Eleven Labs voice',
    kokoro: 'Kokoro voice'
  }; 