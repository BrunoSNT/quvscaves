import { Character, CharacterCreationOptions } from '../types';
import { GameStats, GameSkills } from '../../../shared/types/game';
import { logger } from '../../../shared/logger';

// Moving content from src/utils/characterSetup.ts
export function setupCharacterDefaults(options: CharacterCreationOptions): Partial<Character> {
    const defaultStats: GameStats = {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10
    };

    const defaultSkills: GameSkills = {
        acrobatics: 0,
        arcana: 0,
        athletics: 0,
        deception: 0,
        history: 0,
        insight: 0,
        intimidation: 0,
        investigation: 0,
        medicine: 0,
        nature: 0,
        perception: 0,
        performance: 0,
        persuasion: 0,
        religion: 0,
        sleightOfHand: 0,
        stealth: 0,
        survival: 0
    };

    // Merge default stats with provided stats
    const mergedStats: GameStats = {
        ...defaultStats,
        ...options.stats || {}
    };

    // Merge default skills with provided skills
    const mergedSkills: GameSkills = {
        ...defaultSkills,
        ...options.skills || {}
    };

    return {
        ...options,
        level: 1,
        experience: 0,
        health: 100,
        maxHealth: 100,
        mana: 100,
        maxMana: 100,
        stats: mergedStats,
        skills: mergedSkills,
        inventory: [],
        effects: [],
        proficiencies: [],
        languages: ['Common'],
        spells: [],
        abilities: [],
        strength: mergedStats.strength,
        dexterity: mergedStats.dexterity,
        constitution: mergedStats.constitution,
        intelligence: mergedStats.intelligence,
        wisdom: mergedStats.wisdom,
        charisma: mergedStats.charisma
    };
}

export function validateCharacterCreation(options: CharacterCreationOptions): boolean {
    if (!options.name || options.name.length < 2) {
        return false;
    }
    if (!options.class) {
        return false;
    }
    if (!options.race) {
        return false;
    }
    return true;
}

export function generateCharacterBackground(race: string, characterClass: string): string {
    return `A brave ${race} ${characterClass} setting out on their first adventure.`;
} 