import { logger } from "utils/logger";

export interface CombatParticipant {
    id: string;
    initiative: number;
    isNPC: boolean;
    health: number;
    maxHealth: number;
    statusEffects: string[];
}

export interface CombatState {
    isActive: boolean;
    round: number;
    currentTurn: string;
    participants: CombatParticipant[];
}

export function initiateCombat(playerId: string, playerHealth: number): CombatState {
    const combatId = `combat_${Date.now()}`;
    logger.debug('Combat initiated:', { combatId, playerId });

    // Roll initiative for player (d20)
    const playerInitiative = Math.floor(Math.random() * 20) + 1;
    
    // Create initial combat state
    const initialState: CombatState = {
        isActive: true,
        round: 1,
        currentTurn: playerId,
        participants: [
            {
                id: playerId,
                initiative: playerInitiative,
                isNPC: false,
                health: playerHealth,
                maxHealth: playerHealth,
                statusEffects: []
            }
        ]
    };

    logger.debug('Initial combat state:', initialState);
    return initialState;
}

export function addNPCToCombat(state: CombatState, npcId: string, health: number): CombatState {
    // Roll initiative for NPC
    const npcInitiative = Math.floor(Math.random() * 20) + 1;
    
    const updatedParticipants = [...state.participants, {
        id: npcId,
        initiative: npcInitiative,
        isNPC: true,
        health,
        maxHealth: health,
        statusEffects: []
    }];
    
    // Sort participants by initiative
    updatedParticipants.sort((a, b) => b.initiative - a.initiative);
    
    return {
        ...state,
        participants: updatedParticipants,
        currentTurn: updatedParticipants[0].id
    };
}

export function nextTurn(state: CombatState): CombatState {
    if (!state.isActive || state.participants.length === 0) {
        return state;
    }

    const currentIndex = state.participants.findIndex(p => p.id === state.currentTurn);
    const nextIndex = (currentIndex + 1) % state.participants.length;
    
    // If we're back to the first participant, increment round
    const newRound = nextIndex === 0 ? state.round + 1 : state.round;
    
    return {
        ...state,
        round: newRound,
        currentTurn: state.participants[nextIndex].id
    };
}

export function applyDamage(state: CombatState, targetId: string, damage: number): CombatState {
    const updatedParticipants = state.participants.map(p => {
        if (p.id === targetId) {
            const newHealth = Math.max(0, p.health - damage);
            return { ...p, health: newHealth };
        }
        return p;
    });
    
    // Check if combat should end
    const shouldEndCombat = updatedParticipants.every(p => p.isNPC ? p.health <= 0 : true);
    
    return {
        ...state,
        isActive: !shouldEndCombat,
        participants: updatedParticipants
    };
}

export function endCombat(state: CombatState): CombatState {
    return {
        ...state,
        isActive: false
    };
} 