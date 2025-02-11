import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageActionRowComponentBuilder, TextChannel, Guild, VoiceBasedChannel } from 'discord.js';
import { prisma } from '../lib/prisma';
import { updateCharacterSheet } from './index';
import { CombatManager } from '../combat/manager';
import { logger } from './logger';
import { AIResponse } from 'ai/gamemaster';
import { parseEffects, toGameCharacter } from 'commands/adventure/action';

export interface ResponseSections {
    narration: string;
    atmosphere: string;
    actions: string[];
    effects: string;
    memory: string;
}

export interface ActionButton {
    id: string;
    label: string;
    action: string;
}

export function extractSections(response: AIResponse): ResponseSections {
    const responseText = response.response || '';
    return {
        narration: responseText.match(/\[(Narração|Narration)\](.*?)(?=\[|$)/s)?.[2]?.trim() || '',
        atmosphere: responseText.match(/\[(Atmosfera|Atmosphere)\](.*?)(?=\[|$)/s)?.[2]?.trim() || '',
        actions: responseText.match(/\[(Ações Disponíveis|Available Actions|Sugestões de Ação|Suggested Actions)\](.*?)(?=\[|$)/s)?.[2]?.trim()?.split('\n') || [],
        effects: responseText.match(/\[(Efeitos|Effects)\](.*?)(?=\[|$)/s)?.[2]?.trim() || '',
        memory: responseText.match(/\[(Memória|Memory)\](.*?)(?=\[|$)/s)?.[2]?.trim() || ''
    };
}

export function createResponseEmbed(sections: ResponseSections, characterName: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor('#2B2D31')
        .setTitle(`🎭 ${characterName}'s Adventure`)
        .setDescription(sections.narration)
        .addFields([
            { 
                name: '🌟 Atmosphere', 
                value: sections.atmosphere || 'No atmosphere description', 
                inline: false 
            },
            { 
                name: '✨ Effects', 
                value: sections.effects || 'No active effects', 
                inline: false 
            },
            { 
                name: '📜 Memory', 
                value: '```json\n' + (sections.memory || '{}') + '\n```', 
                inline: false 
            }
        ])
        .setFooter({ 
            text: '🎲 Choose your next action below', 
            iconURL: 'https://i.imgur.com/AfFp7pu.png' 
        })
        .setTimestamp();
}

export function createActionButtons(actions: string[]): { rows: ActionRowBuilder<MessageActionRowComponentBuilder>[]; buttons: ActionButton[] } {
    // Filter and clean up actions
    const cleanedActions = actions
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().replace(/^-\s*/, ''))
        .filter(action => action.length > 0);

    // Default actions if none are provided
    if (cleanedActions.length === 0) {
        cleanedActions.push(
            'Wait and observe',
            'Search the area carefully',
            'Prepare for potential danger'
        );
    }

    const buttons: ActionButton[] = cleanedActions.map((action, index) => ({
        id: `action_${index}`,
        label: action.length > 80 ? action.substring(0, 77) + '...' : action,
        action
    }));

    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        const groupButtons = buttons.slice(i, i + 5);
        
        groupButtons.forEach(button => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(button.id)
                    .setLabel(button.label)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚔️')
            );
        });
        
        rows.push(row);
    }

    return { rows, buttons };
}

export async function saveScene(
    adventureId: string, 
    response: AIResponse, 
    sections: ResponseSections, 
    action: string,
    currentScene?: any
): Promise<void> {
    await prisma.scene.create({
        data: {
            adventureId,
            name: `Scene ${Date.now()}`,
            description: response.response || '',
            summary: sections.narration?.split('\n')[0] || 'No summary',
            keyEvents: [],
            npcInteractions: JSON.stringify({}),
            decisions: JSON.stringify([action]),
            questProgress: JSON.stringify({}),
            locationContext: currentScene?.locationContext || ''
        }
    });
}

export async function handleEffects(
    sections: ResponseSections,
    userCharacter: any,
    userAdventure: any,
    characterChannel?: TextChannel
): Promise<void> {
    if (!sections.effects) return;

    const { 
        statusEffects, 
        healthChange, 
        manaChange, 
        experienceChange,
        absoluteHealth,
        absoluteMana,
        combatAction
    } = parseEffects(sections.effects);

    // Handle combat state changes
    if (combatAction === 'start') {
        const combat = await prisma.combat.findFirst({
            where: {
                adventureId: userAdventure.id,
                status: 'ACTIVE'
            }
        });

        if (!combat) {
            const playerCharacters = userAdventure.players.map(p => toGameCharacter(p.character));
            const combatManager = await CombatManager.initiateCombat(userAdventure.id, playerCharacters);
            const state = combatManager.getState();

            await prisma.combat.create({
                data: {
                    adventureId: state.adventureId,
                    round: state.round,
                    currentTurn: Number(state.currentTurn), // Convert string to number
                    status: state.status,
                    participants: {
                        create: state.participants.map(p => ({
                            characterId: p.characterId,
                            initiative: p.initiative,
                            isNPC: p.isNPC || false
                        }))
                    }
                }
            });
        }
    } else if (combatAction === 'end') {
        await prisma.combat.updateMany({
            where: {
                adventureId: userAdventure.id,
                status: 'ACTIVE'
            },
            data: {
                status: 'COMPLETED'
            }
        });
    }

    // Update character stats if needed
    if (healthChange || manaChange || experienceChange || absoluteHealth !== undefined || absoluteMana !== undefined) {
        const updateData: any = {};
        
        if (absoluteHealth !== undefined) {
            updateData.health = Math.min(absoluteHealth, userCharacter.maxHealth);
        } else if (healthChange) {
            updateData.health = Math.min(
                userCharacter.maxHealth,
                Math.max(0, userCharacter.health + healthChange)
            );
        }
        
        if (absoluteMana !== undefined) {
            updateData.mana = Math.min(absoluteMana, userCharacter.maxMana);
        } else if (manaChange) {
            updateData.mana = Math.min(
                userCharacter.maxMana,
                Math.max(0, userCharacter.mana + manaChange)
            );
        }

        if (experienceChange) {
            updateData.experience = Math.max(0, userCharacter.experience + experienceChange);
        }

        const updatedCharacter = await prisma.character.update({
            where: { id: userCharacter.id },
            data: updateData
        });
        
        Object.assign(userCharacter, updatedCharacter);

        if (characterChannel) {
            await updateCharacterSheet(userCharacter, characterChannel, statusEffects);
        }
    }
}

export async function updateAdventureMemory(adventureId: string, aiResponse: string) {
    // Extract memory updates from AI response
    const memoryMatch = aiResponse.match(/\[Memory\](.*?)(?=\[|$)/s);
    if (!memoryMatch || !memoryMatch[1]) {
        logger.debug('No memory section found in AI response');
        return;
    }

    const memorySection = memoryMatch[1].trim();
    if (!memorySection) {
        logger.debug('Empty memory section in AI response');
        return;
    }

    // Default scene structure
    const defaultScene = {
        name: `Scene ${Date.now()}`,
        description: '',
        summary: '',
        keyEvents: [],
        npcInteractions: {},
        decisions: [],
        questProgress: {},
        locationContext: '',
    };

    let memoryUpdates;
    try {
        memoryUpdates = JSON.parse(memorySection);
    } catch (parseError) {
        // Instead of rejecting the response, just log the error and fall back to defaults
        logger.warn('Memory section is not valid JSON, defaulting to empty memory', { error: parseError });
        memoryUpdates = { scene: null, memories: [] };
    }

    // If the scene is missing or not an object, use the default scene.
    if (!memoryUpdates.scene || typeof memoryUpdates.scene !== 'object') {
        memoryUpdates.scene = defaultScene;
    } else {
        const sceneData = memoryUpdates.scene;
        memoryUpdates.scene = {
            ...defaultScene,
            ...(sceneData.name ? { name: sceneData.name } : {}),
            ...(sceneData.description ? { description: sceneData.description } : {}),
            ...(sceneData.summary ? { summary: sceneData.summary } : {}),
            keyEvents: Array.isArray(sceneData.keyEvents) ? sceneData.keyEvents : [],
            npcInteractions: (sceneData.npcInteractions && typeof sceneData.npcInteractions === 'object' && !Array.isArray(sceneData.npcInteractions))
                ? sceneData.npcInteractions
                : {},
            decisions: Array.isArray(sceneData.decisions) ? sceneData.decisions : [],
            questProgress: (sceneData.questProgress && typeof sceneData.questProgress === 'object' && !Array.isArray(sceneData.questProgress))
                ? sceneData.questProgress
                : {},
            ...(sceneData.locationContext ? { locationContext: sceneData.locationContext } : {}),
        };
    }

    // Now update scene memory in the database
    try {
        await prisma.scene.create({
            data: {
                adventureId,
                name: memoryUpdates.scene.name,
                description: memoryUpdates.scene.description,
                summary: memoryUpdates.scene.summary,
                keyEvents: memoryUpdates.scene.keyEvents,
                npcInteractions: JSON.stringify(memoryUpdates.scene.npcInteractions),
                decisions: JSON.stringify(memoryUpdates.scene.decisions),
                questProgress: JSON.stringify(memoryUpdates.scene.questProgress),
                locationContext: memoryUpdates.scene.locationContext,
            },
        });
        logger.debug('Scene memory updated successfully');
    } catch (error) {
        logger.error('Error updating scene memory', { error: error instanceof Error ? error.message : error });
    }
}