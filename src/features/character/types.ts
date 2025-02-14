import { GameStats, GameSkills, GameInventoryItem, GameEffect } from '../../shared/types/game';
import { AdventurePlayer } from '../adventure/types';

export interface Character {
    id: string;
    name: string;
    class: string;
    race: string;
    level: number;
    experience: number;
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
    stats: GameStats;
    skills: GameSkills;
    inventory: GameInventoryItem[];
    effects: GameEffect[];
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    proficiencies: string[];
    languages: string[];
    spells: CharacterSpell[];
    abilities: CharacterAbility[];
    background?: string;
    user?: {
        id: string;
        username: string;
    };
    adventures?: AdventurePlayer[];
}

export interface CharacterSpell {
    id: string;
    name: string;
    level: number;
    school: string;
    description: string;
    characterId: string;
}

export interface CharacterAbility {
    id: string;
    name: string;
    type: string;
    description: string;
    uses?: number;
    recharge?: string;
    characterId: string;
}

export interface CharacterCreationOptions {
    name: string;
    class: string;
    race: string;
    stats?: Partial<GameStats>;
    skills?: Partial<GameSkills>;
    background?: string;
}

export interface CharacterService {
    createCharacter(userId: string, options: CharacterCreationOptions): Promise<Character>;
    getCharacter(characterId: string): Promise<Character | null>;
    deleteCharacter(characterId: string, userId: string): Promise<void>;
    updateCharacter(characterId: string, userId: string, updates: Partial<Character>): Promise<Character>;
    listCharacters(userId: string): Promise<Character[]>;
} 