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

export function formatSkillCheckResult(result: SkillCheckResult, language: string = 'en-US'): string {
    const outcome = result.success ? 
        (language === 'en-US' ? 'Success' : 'Sucesso') : 
        (language === 'en-US' ? 'Failure' : 'Falha');
    
    const margin = Math.abs(result.margin);
    const marginText = language === 'en-US' ? 
        `by ${margin}` : 
        `por ${margin}`;

    const criticalText = result.criticalSuccess ? 
        (language === 'en-US' ? '(Critical Success!)' : '(Sucesso Crítico!)') :
        result.criticalFailure ? 
            (language === 'en-US' ? '(Critical Failure!)' : '(Falha Crítica!)') : 
            '';

    return `🎲 ${outcome} ${marginText} ${criticalText}`.trim();
} 