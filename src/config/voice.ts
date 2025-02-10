import { KokoroVoice } from '../types/game';

export const KOKORO_VOICES_BY_LANGUAGE = {
    'en-US': [
        { label: 'Heart (English)', value: 'af_heart' as KokoroVoice },
        { label: 'Soul (English)', value: 'af_soul' as KokoroVoice },
        { label: 'Mind (English)', value: 'af_mind' as KokoroVoice },
        { label: 'Spirit (English)', value: 'af_spirit' as KokoroVoice }
    ],
    'pt-BR': [
        { label: 'Heart (Portuguese)', value: 'pf_heart' as KokoroVoice },
        { label: 'Soul (Portuguese)', value: 'pf_soul' as KokoroVoice }
    ]
} as const;

export const VOICE_DESCRIPTIONS = {
    none: 'No voice output',
    discord: 'Use Discord\'s built-in TTS',
    elevenlabs: 'Use ElevenLabs for high-quality cloud voices',
    kokoro: 'Use Kokoro for high-quality offline voices'
} as const; 