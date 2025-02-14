import { SupportedLanguage } from '../i18n/types';
import { Character } from '../../features/character/types';

export interface AdventureSettings {
    worldStyle: WorldStyle;
    toneStyle: ToneStyle;
    magicLevel: MagicLevel;
    setting?: string;
    language: SupportedLanguage;
    useVoice?: boolean;
}

export interface GameState {
    health: number;
    mana: number;
    inventory: string[];
    questProgress: string;
}

export interface Memory {
    recentScenes: Array<{
        summary: string;
    }>;
    activeQuests: Array<{
        title: string;
        description: string;
    }>;
    knownCharacters: Array<{
        title: string;
        description: string;
    }>;
    discoveredLocations: Array<{
        title: string;
        description: string;
    }>;
    importantItems: Array<{
        title: string;
        description: string;
    }>;
}

export interface CombatParticipant {
    id: string;
    initiative: number;
    health: number;
    maxHealth: number;
    statusEffects: string[];
}

export interface Combat {
    round: number;
    currentTurn: string;
    participants: CombatParticipant[];
}

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
    players: any[];
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    user?: {
        id: string;
        username: string;
    };
}

export interface GameContext {
    adventure?: Adventure;
    scene: string;
    characters: Character[];
    playerActions: string[];
    currentState: GameState;
    adventureSettings: AdventureSettings;
    language: SupportedLanguage;
    memory: Memory;
    combat?: Combat;
} 

export enum WorldStyle {
    FANTASY = 'FANTASY',
    SCIFI = 'SCIFI',
    MODERN = 'MODERN',
    HORROR = 'HORROR',
    CYBERPUNK = 'CYBERPUNK',
    STEAMPUNK = 'STEAMPUNK',
    WESTERN = 'WESTERN',
    HISTORICAL = 'HISTORICAL',
    POSTAPOCALYPTIC = 'POSTAPOCALYPTIC'
}

export enum ToneStyle {
    HEROIC = 'HEROIC',
    GRITTY = 'GRITTY',
    COMEDIC = 'COMEDIC',
    DRAMATIC = 'DRAMATIC',
    MYSTERIOUS = 'MYSTERIOUS',
    SERIOUS = 'SERIOUS',
    LIGHTHEARTED = 'LIGHTHEARTED',
    DARK = 'DARK',
    EPIC = 'EPIC'
}

export enum MagicLevel {
    NONE = 'NONE',
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    EPIC = 'EPIC'
}

export type VoiceType = 'none' | 'discord' | 'elevenlabs' | 'kokoro';

export interface GameStats {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
}

export interface GameSkills {
    acrobatics: number;
    arcana: number;
    athletics: number;
    deception: number;
    history: number;
    insight: number;
    intimidation: number;
    investigation: number;
    medicine: number;
    nature: number;
    perception: number;
    performance: number;
    persuasion: number;
    religion: number;
    sleightOfHand: number;
    stealth: number;
    survival: number;
}

export interface GameInventoryItem {
    id: string;
    name: string;
    description: string;
    quantity: number;
    type: 'WEAPON' | 'ARMOR' | 'CONSUMABLE' | 'QUEST' | 'MISC';
    properties?: Record<string, any>;
}

export interface GameEffect {
    id: string;
    name: string;
    description: string;
    duration: number;
    type: 'BUFF' | 'DEBUFF' | 'CONDITION';
    properties?: Record<string, any>;
}

export type AdventurePrivacy = 'public' | 'friends_only' | 'private'; 