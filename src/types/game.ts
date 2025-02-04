export type SupportedLanguage = 'en-US' | 'pt-BR';
export type VoiceType = 'discord' | 'elevenlabs';
export type CharacterClass = 'warrior' | 'mage' | 'rogue';
export type AdventureStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED';
export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type AdventurePrivacy = 'public' | 'friends_only' | 'private';

export type WorldStyle = 
    | 'high_fantasy'    // Classic D&D-style fantasy
    | 'dark_fantasy'    // Darker themes, more dangerous world
    | 'steampunk'       // Technology and magic mix
    | 'medieval'        // Low magic, historical feel
    | 'mythological'    // Based on real-world mythology
    | 'post_apocalyptic'; // Ruined fantasy world

export type ToneStyle = 
    | 'heroic'          // Epic hero's journey
    | 'gritty'          // Realistic and harsh
    | 'humorous'        // Light-hearted and funny
    | 'mysterious'      // Focus on intrigue and secrets
    | 'horror'          // Scary and suspenseful
    | 'political';      // Focus on intrigue and power

export type MagicLevel = 
    | 'high'            // Magic is common and powerful
    | 'medium'          // Magic exists but is limited
    | 'low'             // Magic is rare and mysterious
    | 'none';           // No magic, purely mundane world

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