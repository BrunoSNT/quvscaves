import { Character } from '../../types/game';
import { CombatManager } from '../manager';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { CombatAction } from '../types';

export async function detectCombatTriggers(action: string): Promise<{ isCombat: boolean; type: string | null }> {
    const combatActions = {
        attack: ['atacar', 'attack', 'golpear', 'strike', 'hit', 'punch', 'kick', 'slash', 'stab', 'shoot', 'throw', 'cast', 'launch', 'soco', 'bater', 'lutar'],
        defend: ['defender', 'defend', 'block', 'shield', 'protect', 'guard', 'parry', 'dodge', 'proteger', 'esquivar'],
        flee: ['fugir', 'flee', 'run', 'escape', 'retreat', 'withdraw', 'evade', 'correr', 'escapar'],
        cast: ['conjurar', 'cast', 'spell', 'magic', 'magia', 'feitiço', 'enchant', 'lançar'],
        initiate: ['lutar', 'fight', 'confrontar', 'confront', 'provocar', 'provoke', 'desafiar', 'challenge', 'duel', 'battle', 'combate', 'brigar']
    };

    const actionLower = action.toLowerCase();
    
    // Check for combat initiation first
    if (combatActions.initiate.some(trigger => actionLower.includes(trigger))) {
        logger.debug('Combat initiated by initiation action:', { action });
        return { isCombat: true, type: 'initiate' };
    }

    // Check for specific combat actions
    for (const [type, triggers] of Object.entries(combatActions)) {
        if (triggers.some(trigger => actionLower.includes(trigger))) {
            logger.debug('Combat initiated by combat action:', { action, type });
            return { isCombat: true, type: type.toUpperCase() as CombatAction };
        }
    }

    return { isCombat: false, type: null };
}

export async function initiateCombat(adventureId: string, players: Character[], npcs: Character[] = []) {
    try {
        // Check if combat is already active
        const existingCombat = await prisma.combat.findFirst({
            where: {
                adventureId: adventureId,
                status: 'ACTIVE'
            },
            include: {
                participants: {
                    include: {
                        character: true
                    }
                }
            }
        });

        if (existingCombat) {
            logger.debug('Combat already active for adventure:', adventureId);
            return existingCombat;
        }

        // Initialize combat through the manager
        const combatManager = await CombatManager.initiateCombat(adventureId, players, npcs);
        const state = combatManager.getState();

        // Create combat record in database
        const combat = await prisma.combat.create({
            data: {
                id: state.id,
                adventureId: state.adventureId,
                round: state.round,
                currentTurn: state.currentTurn,
                status: state.status,
                participants: {
                    create: state.participants.map(p => ({
                        characterId: p.characterId,
                        initiative: p.initiative,
                        isNPC: p.isNPC || false
                    }))
                }
            },
            include: {
                participants: {
                    include: {
                        character: true
                    }
                }
            }
        });

        logger.debug('Combat initiated:', { 
            combatId: combat.id, 
            participants: combat.participants.length 
        });

        return combat;
    } catch (error) {
        logger.error('Error initiating combat:', error);
        throw error;
    }
}

export async function endCombat(combatId: string) {
    try {
        await prisma.combat.update({
            where: { id: combatId },
            data: { status: 'COMPLETED' }
        });

        logger.debug('Combat ended:', { combatId });
    } catch (error) {
        logger.error('Error ending combat:', error);
        throw error;
    }
}

export async function getCombatState(adventureId: string) {
    return await prisma.combat.findFirst({
        where: {
            adventureId: adventureId,
            status: 'ACTIVE'
        },
        include: {
            participants: {
                include: {
                    character: true,
                    effects: true
                }
            },
            log: true
        }
    });
} 