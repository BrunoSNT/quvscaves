import { SupportedLanguage } from '../i18n/types';
import { Character } from '../../features/character/types';

export interface AdventureSettings {
    worldStyle: WorldStyle;
    toneStyle: ToneStyle;
    magicLevel: MagicLevel;
    setting?: string;
    language: SupportedLanguage;
    useVoice?: boolean;
    rollMode: RollMode;  // How skill checks should be handled
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
        timestamp?: Date;
        type?: string;
    }>;
    activeQuests: Array<{
        title: string;
        description: string;
        status?: string;
    }>;
    knownCharacters: Array<{
        title: string;
        description: string;
        type?: string;
    }>;
    discoveredLocations: Array<{
        title: string;
        description: string;
        visited?: boolean;
    }>;
    importantItems: Array<{
        title: string;
        description: string;
        type?: string;
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
    rollMode: RollMode;  // Adding rollMode here
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
    scene?: string;
    characters: GameCharacter[];
    playerActions: string[];
    currentState: {
        health: number;
        mana: number;
        inventory: GameInventoryItem[];
        questProgress: Record<string, any>;
    };
    language: string;
    memory: Memory;
    additionalContext?: string[];
    reasoning?: string[];  // Add reasoning array for AI context
    availableTools?: Array<{ name: string; description: string }>;  // Add availableTools property
    combat?: CombatState;
    lastSkillCheck?: {
        check: SkillCheck;
        result: {
            success: boolean;
            roll: number;
            total: number;
            difficulty: number;
            margin: number;
            criticalSuccess: boolean;
            criticalFailure: boolean;
        };
    };
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

export enum RollMode {
    ACTIVE = 'ACTIVE',      // Players must actively roll for skill checks
    BACKGROUND = 'BACKGROUND'  // Skill checks are automatically rolled in the background
}

export type VoiceType = 'NONE' | 'DISCORD' | 'ELEVENLABS' | 'KOKORO';

export interface GameStats {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
}

export type GameSkills = {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    [key: string]: number; // Allow for custom skills
};

export interface GameInventoryItem {
    id: string;
    name: string;
    description: string;
    quantity: number;
    type: 'WEAPON' | 'ARMOR' | 'CONSUMABLE' | 'QUEST' | 'MISC';
    properties?: Record<string, any>;
}

export interface GameReward {
    type: 'ITEM' | 'EXPERIENCE' | 'SPELL' | 'ABILITY' | 'GOLD';
    message: string;
    items?: GameInventoryItem[];
    experience?: number;
    spell?: {
        name: string;
        level: number;
        school: string;
        description: string;
    };
    ability?: {
        name: string;
        type: string;
        description: string;
        uses?: number;
        recharge?: string;
    };
    gold?: number;
}

export interface GameLoot {
    source: 'CHEST' | 'NPC' | 'QUEST' | 'COMBAT';
    rewards: GameReward[];
    description: string;
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

export enum ActionType {
    NARRATIVE = 'NARRATIVE',   // Story progression, exploration, dialogue
    COMBAT = 'COMBAT',        // Combat initiation or combat actions
    QUESTION = 'QUESTION'     // Actions that request more information
}

export interface GameAction {
    type: ActionType;
    text: string;
    metadata?: {
        combatIntent?: boolean;
        targetId?: string;
        abilityId?: string;
        itemId?: string;
    };
}

export interface CombatAction {
    type: 'ATTACK' | 'SPELL' | 'ABILITY' | 'ITEM' | 'MOVE' | 'DEFEND';
    targetId?: string;
    abilityId?: string;
    itemId?: string;
    description: string;
}

export interface CombatState extends Combat {
    status: 'ACTIVE' | 'PENDING' | 'COMPLETE';
    turnOrder: string[];
    availableActions: CombatAction[];
    lastAction?: CombatAction;
    roundHistory: Array<{
        round: number;
        actions: CombatAction[];
    }>;
}

export interface CombatDetectionResult {
    isCombat: boolean;
    participants?: string[];
    triggerAction?: string;
}

export type GameCharacter = Character & {
    stats: {
        wisdom: number;
        charisma: number;
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
    };
    skills: string[];
    inventory: GameInventoryItem[];
    effects: string[];
    proficiencies: string[];
    languages: string[];
    spells: string[];
    abilities: string[];
};

export interface SkillCheck {
    skill: string;
    difficulty: number;
    advantage: boolean;
    disadvantage: boolean;
    modifiers?: Record<string, number>;
} 