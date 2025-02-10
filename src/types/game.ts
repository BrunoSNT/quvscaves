export type SupportedLanguage = 'en-US' | 'pt-BR';
export type VoiceType = 'none' | 'discord' | 'elevenlabs' | 'kokoro';
export type CharacterClass = 'warrior' | 'mage' | 'rogue' | 'ranger' | 'paladin';
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

export interface Spell {
    id: string;
    name: string;
    level: number;
    school: string;
    description: string;
    castingTime: string;
    range: string;
    duration: string;
    components: string[];
}

export interface Ability {
    id: string;
    name: string;
    type: string;
    description: string;
    uses?: number;
    recharge?: string;
}

export interface Character {
    id: string;
    name: string;
    class: CharacterClass;
    race: string;
    level: number;
    experience: number;
    
    // Base Stats
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    
    // Derived Stats
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
    armorClass: number;
    initiative: number;
    speed: number;
    
    // Equipment and Skills
    proficiencies: string[];
    languages: string[];
    
    // Optional relations
    spells?: Spell[];
    abilities?: Ability[];
    inventory?: any[]; // We'll define a proper type for this later
    
    // Metadata
    createdAt?: Date;
    updatedAt?: Date;
}

export interface GameState {
    health: number;
    mana: number;
    inventory: string[];
    questProgress: string;
    lastCombatAction?: {
        type: 'attack' | 'defend' | 'flee' | 'cast' | 'use';
        success: boolean;
        damage?: number;
        target?: string;
        effect?: string;
    };
}

export interface CombatState {
    isActive: boolean;
    round: number;
    turnOrder: string[];  // Character IDs in initiative order
    currentTurn: string;  // Character ID whose turn it is
    participants: {
        id: string;
        initiative: number;
        isNPC: boolean;
        health: number;
        maxHealth: number;
        statusEffects: string[];
    }[];
}

export interface SceneContext {
    description: string;
    summary: string;
    keyEvents: string[];
    npcInteractions: Record<string, any>;
    decisions: any[];
    questProgress: Record<string, any>;
    locationContext: string;
}

export interface Memory {
    id: string;
    type: string;
    title: string;
    description: string;
    importance: number;
    status: string;
    tags: string[];
    relatedMemories: string[];
}

export interface GameContext {
    scene: string;
    playerActions: string[];
    characters: Character[];
    currentState: GameState;
    language: SupportedLanguage;
    combat?: CombatState;
    adventureSettings: {
        worldStyle: WorldStyle;
        toneStyle: ToneStyle;
        magicLevel: MagicLevel;
        setting?: string;
    };
    memory: {
        currentScene: SceneContext;
        recentScenes: SceneContext[];  // Last 3-5 scenes for immediate context
        significantMemories: Memory[];  // Important narrative elements
        activeQuests: Memory[];        // Current quest lines
        knownCharacters: Memory[];     // NPCs and their relationships
        discoveredLocations: Memory[]; // Places visited or learned about
        importantItems: Memory[];      // Significant items in the narrative
    };
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

export type KokoroVoice = 
    | 'af_heart' | 'af_soul' | 'af_mind' | 'af_spirit'  // English
    | 'ef_heart' | 'ef_soul'                            // Spanish
    | 'ff_heart' | 'ff_soul'                            // French
    | 'jf_heart' | 'jf_soul'                            // Japanese
    | 'zf_heart' | 'zf_soul'                            // Chinese
    | 'hf_heart' | 'hf_soul'                            // Hindi
    | 'if_heart' | 'if_soul'                            // Italian
    | 'pf_heart' | 'pf_soul';                           // Portuguese

export interface VoiceConfig {
    type: VoiceType;
    voice?: KokoroVoice;
    speed?: number;
} 