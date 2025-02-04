export type SupportedLanguage = 'en-US' | 'pt-BR';
export type VoiceType = 'discord' | 'elevenlabs';
export type CharacterClass = 'warrior' | 'mage' | 'rogue';
export type AdventureStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED';
export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface Character {
    id: string;
    name: string;
    class: CharacterClass;
    level: number;
    health: number;
    mana: number;
    experience: number;
}

export interface GameState {
    health: number;
    mana: number;
    inventory: string[];
    questProgress: string;
}

export interface GameContext {
    scene: string;
    playerActions: string[];
    characters: Character[];
    currentState: GameState;
    language: SupportedLanguage;
}

export interface VoiceSettings {
    stability: number;
    similarityBoost: number;
}

export interface GameConfig {
    defaultHealth: number;
    defaultMana: number;
    defaultLevel: number;
    maxInventorySize: number;
    voiceSettings: VoiceSettings;
} 