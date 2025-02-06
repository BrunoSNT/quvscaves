import { Character } from '../types/game';

export type CombatAction = 'ATTACK' | 'CAST' | 'DEFEND' | 'USE_ITEM' | 'FLEE';

export type CombatStatus = 'ACTIVE' | 'COMPLETED' | 'FLED';

export interface CombatState {
    id: string;
    adventureId: string;
    round: number;
    turnOrder: string[];  // Participant IDs in initiative order
    currentTurn: number;
    status: CombatStatus;
    participants: CombatParticipant[];
    log: CombatLogEntry[];
}

export interface CombatParticipant {
    id: string;
    characterId: string;
    character: Character;
    initiative: number;
    temporaryEffects: StatusEffect[];
    isNPC: boolean;
}

export type EffectType = 'BUFF' | 'DEBUFF' | 'DAMAGE' | 'HEAL';
export type EffectTarget = 'AC' | 'ATTACK' | 'DAMAGE' | 'HEALTH' | 'INITIATIVE';

export interface StatusEffect {
    name: string;
    duration: number;  // Rounds remaining
    effect: {
        type: EffectType;
        target: EffectTarget;
        value: number;
    };
}

export interface CombatLogEntry {
    round: number;
    turn: number;
    actorId: string;
    targetId?: string;
    action: CombatAction;
    details: string;
    outcome: string;
    timestamp: Date;
}

export interface CombatContext {
    isActive: boolean;
    round: number;
    turnOrder: string[];
    currentTurn: string;
    participants: {
        id: string;
        initiative: number;
        isNPC: boolean;
        health: number;
        maxHealth: number;
        statusEffects: string[];
    }[];
} 