import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage } from '../../types/game';
import { CombatManager } from '../manager';
import { CombatAction } from '../types';
import { CharacterClass } from '../../types/game';

export async function handleCombatAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        // Get the active combat for this user
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                characters: {
                    include: {
                        adventures: {
                            where: {
                                adventure: {
                                    status: 'ACTIVE'
                                }
                            },
                            include: {
                                adventure: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            await interaction.editReply(getMessages(interaction.locale as SupportedLanguage).errors.registerFirst);
            return;
        }

        const activeAdventure = user.characters[0]?.adventures[0]?.adventure;
        if (!activeAdventure) {
            await interaction.editReply(getMessages(interaction.locale as SupportedLanguage).errors.needActiveAdventure);
            return;
        }

        const activeCombat = await prisma.combat.findFirst({
            where: {
                adventureId: activeAdventure.id,
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

        if (!activeCombat) {
            await interaction.editReply('No active combat found. Use /action to initiate combat.');
            return;
        }

        const action = interaction.options.getString('action', true) as CombatAction;
        const targetId = interaction.options.getString('target') ?? undefined;

        // Reconstruct combat manager
        const combatManager = new CombatManager({
            id: activeCombat.id,
            adventureId: activeCombat.adventureId,
            round: activeCombat.round,
            currentTurn: activeCombat.currentTurn,
            status: activeCombat.status,
            turnOrder: activeCombat.participants.map(p => p.id),
            participants: activeCombat.participants.map(p => ({
                id: p.id,
                characterId: p.characterId,
                character: { ...p.character, class: p.character.class as CharacterClass },
                initiative: p.initiative,
                temporaryEffects: [],
                isNPC: p.isNPC
            })),
            log: activeCombat.log.map(entry => ({
                round: entry.round,
                turn: entry.turn,
                actorId: entry.actorId,
                targetId: entry.targetId || undefined,
                action: entry.action as CombatAction,
                details: entry.details,
                outcome: entry.outcome,
                timestamp: entry.timestamp
            }))
        });

        // Perform the action
        await combatManager.performAction(action, targetId);
        const newState = combatManager.getState();

        // Update combat state in database
        await prisma.combat.update({
            where: { id: activeCombat.id },
            data: {
                round: newState.round,
                currentTurn: newState.currentTurn,
                status: newState.status
            }
        });

        // Format and send response
        const response = formatCombatState(newState);
        await interaction.editReply(response);

    } catch (error) {
        logger.error('Error in combat action:', error);
        await interaction.editReply({
            content: getMessages(interaction.locale as SupportedLanguage).errors.genericError
        });
    }
}

function formatCombatState(state: any) {
    const currentParticipant = state.participants.find((p: any) => 
        p.id === state.turnOrder[state.currentTurn]
    );

    const turnOrder = state.turnOrder
        .map((id: string) => {
            const participant = state.participants.find((p: any) => p.id === id);
            return `${participant.character.name} (Initiative: ${participant.initiative})`;
        })
        .join('\n');

    const effects = state.participants
        .flatMap((p: any) => p.temporaryEffects.map((e: any) => 
            `${p.character.name}: ${e.name} (${e.duration} rounds)`
        ))
        .join('\n');

    const lastLog = state.log[state.log.length - 1];
    const logEntry = lastLog ? 
        `${lastLog.details}\n${lastLog.outcome}` : 
        'Combat begins!';

    return {
        content: `**Combat Round ${state.round}**\n\n` +
                `Current Turn: ${currentParticipant.character.name}\n\n` +
                `Turn Order:\n${turnOrder}\n\n` +
                `Active Effects:\n${effects || 'None'}\n\n` +
                `Last Action:\n${logEntry}`,
        ephemeral: false
    };
} 