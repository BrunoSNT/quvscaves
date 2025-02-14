import { GameStats, GameSkills } from '../game/types';

export function generateDefaultStats(): GameStats {
    return {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10
    };
}

export function generateDefaultSkills(): GameSkills {
    return {
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
}

export const DEFAULT_HEALTH = 100;
export const DEFAULT_MANA = 100;
export const DEFAULT_LEVEL = 1;
export const DEFAULT_EXPERIENCE = 0; 