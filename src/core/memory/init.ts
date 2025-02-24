import { prisma } from '../prisma';
import { logger, formatGenericOutput } from '../../shared/logger';
import { ProceduralMemory } from './types';

const defaultPrompts: Omit<ProceduralMemory, 'id'>[] = [
    {
        type: 'prompt',
        name: 'default_game_prompt',
        description: `You are a Game Master that enforces rules and maintains narrative consistency.
Create an immersive, responsive world that adapts to player actions.
Balance challenge and player agency while tracking past events and decisions.`,
        parameters: {},
        metadata: {
            category: 'game',
            priority: 1
        }
    },
    {
        type: 'prompt',
        name: 'combat_prompt',
        description: `You are managing a turn-based combat encounter.
Track initiative, health, and status effects.
Apply combat rules consistently and fairly.`,
        parameters: {
            round: 'number',
            participants: 'array'
        },
        metadata: {
            category: 'combat',
            priority: 2
        }
    }
];

const defaultTools: Omit<ProceduralMemory, 'id'>[] = [
    {
        type: 'tool',
        name: 'roll_dice',
        description: 'Roll dice for skill checks, combat, or other random events',
        parameters: {
            dice: 'string',
            modifier: 'number'
        },
        metadata: {
            category: 'utility',
            priority: 1
        }
    },
    {
        type: 'tool',
        name: 'check_skill',
        description: 'Perform a skill check against character abilities',
        parameters: {
            skill: 'string',
            difficulty: 'number'
        },
        metadata: {
            category: 'game',
            priority: 1
        }
    }
];

const combatTools: Omit<ProceduralMemory, 'id'>[] = [
    {
        type: 'tool',
        name: 'initialize_combat',
        description: 'Start a combat encounter with specified participants',
        parameters: {
            participants: 'array',
            initiativeOrder: 'array',
            triggerAction: 'string'
        },
        metadata: {
            category: 'combat',
            priority: 1
        }
    },
    {
        type: 'tool',
        name: 'process_combat_action',
        description: 'Process a combat action and update combat state',
        parameters: {
            action: 'CombatAction',
            currentTurn: 'string',
            combatState: 'CombatState'
        },
        metadata: {
            category: 'combat',
            priority: 1
        }
    }
];

export async function initializeMemorySystem() {
    try {
        logger.info('Initializing memory system...');

        // Clear existing procedural memories
        await prisma.proceduralMemory.deleteMany({});

        // Add default prompts
        for (const prompt of defaultPrompts) {
            await prisma.proceduralMemory.create({
                data: prompt
            });
        }

        // Add default tools
        for (const tool of defaultTools) {
            await prisma.proceduralMemory.create({
                data: tool
            });
        }

        // Add combat tools
        for (const tool of combatTools) {
            await prisma.proceduralMemory.create({
                data: tool
            });
        }

        logger.info('Successfully initialized memory system with default values');
    } catch (error) {
        logger.error('Error initializing memory system:' + formatGenericOutput(JSON.stringify(error)));
        throw error;
    }
} 