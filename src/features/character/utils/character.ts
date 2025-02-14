import { Character, CharacterCreationOptions } from '../types';
import { GameStats, GameSkills } from '../../../shared/types/game';
import { logger } from '../../../shared/logger';

// Moving content from src/utils/character.ts
export function validateCharacterStats(stats: GameStats): boolean {
    // ... existing validation functions ...
}

export function calculateCharacterLevel(experience: number): number {
    // ... existing calculation functions ...
}

export function generateCharacterStats(characterClass: string): GameStats {
    // ... existing generation functions ...
}

export function generateCharacterSkills(characterClass: string): GameSkills {
    // ... existing generation functions ...
} 