import { SupportedLanguage, SUPPORTED_LANGUAGES } from './types';
import { logger } from '../logger';

// Moving content from src/utils/language.ts
export function validateLanguage(language: string): boolean {
    return Object.keys(SUPPORTED_LANGUAGES).includes(language);
}

export function getDefaultLanguage(): SupportedLanguage {
    return 'en-US';
}

export function formatLanguageCode(language: string): SupportedLanguage {
    const formattedCode = language.replace('_', '-').toUpperCase();
    
    if (validateLanguage(formattedCode)) {
        return formattedCode as SupportedLanguage;
    }

    logger.warn(`Unsupported language code: ${language}, falling back to default`);
    return getDefaultLanguage();
}

export function getLanguageConfig(language: string) {
    const code = formatLanguageCode(language);
    return SUPPORTED_LANGUAGES[code];
}

export function getLanguageFlag(language: string): string {
    const config = getLanguageConfig(language);
    return config?.flag || '🌐';
}

export function getLanguageName(language: string): string {
    const config = getLanguageConfig(language);
    return config?.name || 'Unknown';
} 