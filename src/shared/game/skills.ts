import { GameContext } from './types';
import { logger } from '../logger';

export interface SkillCheck {
    skill: string;
    difficulty: number;
    advantage: boolean;
    disadvantage: boolean;
    modifiers?: Record<string, number>;
}

export interface SkillCheckResult {
    success: boolean;
    roll: number;
    total: number;
    difficulty: number;
    margin: number;
    criticalSuccess: boolean;
    criticalFailure: boolean;
}

export enum DifficultyClass {
    VERY_EASY = 5,
    EASY = 10,
    MODERATE = 15,
    HARD = 20,
    VERY_HARD = 25,
    NEARLY_IMPOSSIBLE = 30
}