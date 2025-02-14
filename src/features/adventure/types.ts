import { SupportedLanguage } from 'shared/i18n/types';
import { WorldStyle, ToneStyle, MagicLevel } from '../../shared/types/game';
import { Character } from '../character/types';

export interface Adventure {
    id: string;
    name: string;
    description?: string;
    status: string;
    language: string;
    voiceType: string;
    privacy: string;
    worldStyle: WorldStyle;
    toneStyle: ToneStyle;
    magicLevel: MagicLevel;
    categoryId?: string;
    textChannelId?: string;
    settings: AdventureSettings;
    players: AdventurePlayer[];
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    user?: {
        id: string;
        username: string;
    };
}

export interface AdventurePlayer {
    id: string;
    adventureId: string;
    characterId: string;
    userId: string;
    username: string;
    joinedAt: Date;
    character?: Character;
    adventure?: Adventure;
}

export interface AdventureSettings {
    worldStyle: WorldStyle;
    toneStyle: ToneStyle;
    magicLevel: MagicLevel;
    language: SupportedLanguage;
    useVoice: boolean;
    privacy?: string;
}