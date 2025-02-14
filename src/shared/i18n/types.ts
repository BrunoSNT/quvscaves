export type SupportedLanguage = 'en-US' | 'pt-BR';

export interface LanguageConfig {
    code: SupportedLanguage;
    name: string;
    flag: string;
}

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
    'en-US': {
        code: 'en-US',
        name: 'English',
        flag: '🇺🇸'
    },
    'pt-BR': {
        code: 'pt-BR',
        name: 'Português',
        flag: '🇧🇷'
    }
}; 