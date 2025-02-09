import { ChatInputCommandInteraction, MessagePayload, InteractionReplyOptions, TextChannel, DMChannel, NewsChannel, ThreadChannel, BaseGuildTextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage, GameContext, GameState, CharacterClass, Character, WorldStyle, ToneStyle, MagicLevel } from '../../types/game';
import { generateResponse } from '../../ai/gamemaster';
import { speakInVoiceChannel } from '../../lib/voice';
import { updateCharacterSheet, StatusEffect, ParsedEffects } from '../../utils';
import { CombatManager } from '../../combat/manager';
import { detectCombatTriggers, initiateCombat, getCombatState } from '../../combat/handlers/actions';
import { CombatAction, CombatStatus } from '../../combat/types';

type AdventurePlayerWithCharacter = {
    adventureId: string;
    characterId: string;
    character: {
        userId: string;
        id: string;
        name: string;
        class: string;
        race: string;
        level: number;
        experience: number;
        health: number;
        maxHealth: number;
        mana: number;
        maxMana: number;
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
        wisdom: number;
        charisma: number;
        armorClass: number;
        initiative: number;
        speed: number;
        proficiencies: string[];
        languages: string[];
        spells: any[];
        abilities: any[];
        inventory: any[];
        user: {
            discordId: string;
        };
    }
};

export function parseEffects(effectsText: string): ParsedEffects {
    const effects: StatusEffect[] = [];
    const result: ParsedEffects = { 
        statusEffects: effects, 
        healthChange: 0, 
        manaChange: 0,
        experienceChange: 0
    };
    
    // Add combat effect parsing
    const combatStartRegex = /iniciando combate|combat begins|initiative order/i;
    const combatEndRegex = /combate termina|combat ends|battle is over/i;
    
    if (combatStartRegex.test(effectsText)) {
        result.combatAction = 'start';
    } else if (combatEndRegex.test(effectsText)) {
        result.combatAction = 'end';
    }

    // Match status effects like "+2 Intriga" or "Alerta: +3"
    const statusRegex = /\+(\d+)\s+([^,\n]+)|(\w+):\s*\+(\d+)/g;
    let match;
    while ((match = statusRegex.exec(effectsText)) !== null) {
        const value = parseInt(match[1] || match[4]);
        const name = match[2] || match[3];
        if (name && !isNaN(value)) {
            effects.push({
                name: name.trim(),
                value: value,
                type: determineEffectType(name)
            });
        }
    }

    // Match health changes (both gains and losses)
    const healthGainRegex = /recuperando (\d+) pontos de vida/i;
    const healthLossRegex = /perder (\d+) pontos de vida/i;
    const absoluteHealthRegex = /vida:?\s*(\d+)/i;
    
    const healthGainMatch = effectsText.match(healthGainRegex);
    const healthLossMatch = effectsText.match(healthLossRegex);
    const absoluteHealthMatch = effectsText.match(absoluteHealthRegex);
    
    if (healthGainMatch) {
        result.healthChange = parseInt(healthGainMatch[1]);
    } else if (healthLossMatch) {
        result.healthChange = -parseInt(healthLossMatch[1]);
    } else if (absoluteHealthMatch) {
        result.absoluteHealth = parseInt(absoluteHealthMatch[1]);
    }

    // Match mana changes
    const manaChangeRegex = /(\d+) pontos de mana/i;
    const absoluteManaRegex = /mana:?\s*(\d+)/i;
    const manaMatch = effectsText.match(manaChangeRegex);
    const absoluteManaMatch = effectsText.match(absoluteManaRegex);

    if (manaMatch) {
        result.manaChange = effectsText.toLowerCase().includes('consumiu') ? -parseInt(manaMatch[1]) : parseInt(manaMatch[1]);
    } else if (absoluteManaMatch) {
        result.absoluteMana = parseInt(absoluteManaMatch[1]);
    }

    // Match experience changes
    const xpRegex = /(\+|-)?\s*(\d+)\s*(xp|experiência)/i;
    const xpMatch = effectsText.match(xpRegex);
    if (xpMatch) {
        const multiplier = xpMatch[1] === '-' ? -1 : 1;
        result.experienceChange = multiplier * parseInt(xpMatch[2]);
    }

    return result;
}

function determineEffectType(effectName: string): 'positive' | 'negative' | 'neutral' {
    const positiveEffects = ['alerta', 'força', 'proteção', 'inspiração'];
    const negativeEffects = ['veneno', 'medo', 'fraqueza', 'confusão'];
    
    effectName = effectName.toLowerCase();
    if (positiveEffects.some(effect => effectName.includes(effect))) return 'positive';
    if (negativeEffects.some(effect => effectName.includes(effect))) return 'negative';
    return 'neutral';
}

export function toGameCharacter(dbChar: any): Character {
    return {
        id: dbChar.id,
        name: dbChar.name,
        class: dbChar.class as CharacterClass,
        race: dbChar.race || 'unknown',
        level: dbChar.level || 1,
        experience: dbChar.experience || 0,
        strength: dbChar.strength || 10,
        dexterity: dbChar.dexterity || 10,
        constitution: dbChar.constitution || 10,
        intelligence: dbChar.intelligence || 10,
        wisdom: dbChar.wisdom || 10,
        charisma: dbChar.charisma || 10,
        health: dbChar.health || 100,
        maxHealth: dbChar.maxHealth || 100,
        mana: dbChar.mana || 100,
        maxMana: dbChar.maxMana || 100,
        armorClass: dbChar.armorClass || 10,
        initiative: dbChar.initiative || 0,
        speed: dbChar.speed || 30,
        proficiencies: dbChar.proficiencies || [],
        languages: dbChar.languages || [],
        spells: dbChar.spells || [],
        abilities: dbChar.abilities || [],
        inventory: dbChar.inventory || []
    };
}

export async function getAdventureMemory(adventureId: string) {
    // Get current scene and recent scenes
    const scenes = await prisma.scene.findMany({
        where: { adventureId },
        orderBy: { createdAt: 'desc' },
        take: 5  // Get last 5 scenes
    });

    // Get significant memories
    const memories = await prisma.adventureMemory.findMany({
        where: { 
            adventureId,
            importance: { gte: 3 }  // Only get important memories
        },
        orderBy: { updatedAt: 'desc' }
    });

    // Helper function to clean section tags
    const cleanSectionTags = (text: string) => {
        return text.replace(/\[(Narration|Atmosphere|Dialogue|Effects|Actions|Memory)\]\s*/g, '');
    };

    // Organize memories by type
    const significantMemories = memories.filter(m => m.importance >= 4);
    const activeQuests = memories.filter(m => m.type === 'QUEST' && m.status === 'ACTIVE');
    const knownCharacters = memories.filter(m => m.type === 'CHARACTER');
    const discoveredLocations = memories.filter(m => m.type === 'LOCATION');
    const importantItems = memories.filter(m => m.type === 'ITEM');

    return {
        currentScene: scenes[0] ? {
            description: cleanSectionTags(scenes[0].description),
            summary: cleanSectionTags(scenes[0].summary),
            keyEvents: scenes[0].keyEvents,
            npcInteractions: scenes[0].npcInteractions ? JSON.parse(scenes[0].npcInteractions as string) : {},
            decisions: scenes[0].decisions ? JSON.parse(scenes[0].decisions as string) : [],
            questProgress: scenes[0].questProgress ? JSON.parse(scenes[0].questProgress as string) : {},
            locationContext: scenes[0].locationContext || ''
        } : {
            description: '',
            summary: '',
            keyEvents: [],
            npcInteractions: {},
            decisions: [],
            questProgress: {},
            locationContext: ''
        },
        recentScenes: scenes.slice(1).map(scene => ({
            description: cleanSectionTags(scene.description),
            summary: cleanSectionTags(scene.summary),
            keyEvents: scene.keyEvents,
            npcInteractions: scene.npcInteractions ? JSON.parse(scene.npcInteractions as string) : {},
            decisions: scene.decisions ? JSON.parse(scene.decisions as string) : [],
            questProgress: scene.questProgress ? JSON.parse(scene.questProgress as string) : {},
            locationContext: scene.locationContext || ''
        })),
        significantMemories,
        activeQuests,
        knownCharacters,
        discoveredLocations,
        importantItems
    };
}

async function updateAdventureMemory(adventureId: string, aiResponse: string) {
    // Extract memory updates from AI response
    const memorySection = aiResponse.match(/\[Memory\](.*?)(?=\[|$)/s)?.[1].trim();
    if (!memorySection) return;

    try {
        const memoryUpdates = JSON.parse(memorySection);
        
        // Update scene memory
        if (memoryUpdates.scene) {
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
                    locationContext: memoryUpdates.scene.locationContext
                }
            });
        }

        // Update or create memories
        if (memoryUpdates.memories) {
            for (const memory of memoryUpdates.memories) {
                await prisma.adventureMemory.upsert({
                    where: {
                        id: memory.id || 'new',
                    },
                    create: {
                        adventureId,
                        type: memory.type,
                        title: memory.title,
                        description: memory.description,
                        importance: memory.importance,
                        status: memory.status,
                        tags: memory.tags,
                        relatedMemories: memory.relatedMemories
                    },
                    update: {
                        description: memory.description,
                        importance: memory.importance,
                        status: memory.status,
                        tags: memory.tags,
                        relatedMemories: memory.relatedMemories
                    }
                });
            }
        }
    } catch (error) {
        logger.error('Error updating adventure memory:', error);
    }
}

export function extractSuggestedActions(response: string, language: SupportedLanguage): string[] {
    const actionSection = language === 'pt-BR' 
        ? /\[(?:Sugestões de Ação|Ações Disponíveis|Ações)\](.*?)(?=\[|$)/s
        : /\[(?:Available Actions|Actions|Suggested Actions)\](.*?)(?=\[|$)/s;

    const match = response.match(actionSection);
    if (!match) return [];

    return match[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().replace(/^-\s*/, ''))
        .filter(action => action.length > 0);
}

export function createActionButtons(actions: string[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    
    // Create buttons in groups of 5 (Discord's limit per row)
    for (let i = 0; i < actions.length; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        const groupActions = actions.slice(i, i + 5);
        
        groupActions.forEach((action) => {
            const buttonLabel = action.length > 80 ? action.substring(0, 77) + '...' : action;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`action:${action}`) // Store the full action in the custom ID
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Primary)
            );
        });
        
        rows.push(row);
    }
    
    return rows;
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();
        
        const action = interaction.options.getString('description', true);
        logger.debug(`Processing action for user ${interaction.user.id}: ${action}`);
        
        // First find the user's active adventures through AdventurePlayer
        const userAdventure = await prisma.adventure.findFirst({
            where: { 
                status: 'ACTIVE',
                players: {
                    some: {
                        character: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                }
            },
            include: {
                players: {
                    include: {
                        character: {
                            include: {
                                user: true,
                                spells: true,
                                abilities: true,
                                inventory: true
                            }
                        }
                    }
                },
                scenes: {
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        logger.debug(`Found adventure: ${userAdventure?.id}`);

        if (!userAdventure) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.needActiveAdventure,
            });
            return;
        }

        // Find the user's character in this adventure
        const userCharacter = userAdventure.players.find(
            (p: AdventurePlayerWithCharacter) => p.character.user.discordId === interaction.user.id
        )?.character;

        logger.debug(`Found character: ${userCharacter?.name}`);

        if (!userCharacter) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotInAdventure,
            });
            return;
        }

        const currentScene = userAdventure.scenes[0];
        logger.debug(`Current scene: ${currentScene?.id}`);

        const gameState: GameState = {
            health: userCharacter.health,
            mana: userCharacter.mana,
            inventory: [],
            questProgress: userAdventure.status
        };

        // Get adventure memory
        const memory = await getAdventureMemory(userAdventure.id);

        // Get recent scenes for context
        const recentScenes = await prisma.scene.findMany({
            where: { adventureId: userAdventure.id },
            orderBy: { createdAt: 'desc' },
            take: 5
        });

        const sceneContext = recentScenes.length > 0 
            ? `${recentScenes[0].description}\n\nPrevious events:\n${
                recentScenes.slice(1).map(scene => scene.summary).join('\n')
              }`
            : 'Starting a new adventure...';

        const context: GameContext = {
            scene: sceneContext,
            playerActions: [action],
            characters: userAdventure.players.map(p => toGameCharacter(p.character)),
            currentState: gameState,
            language: (userAdventure.language as SupportedLanguage) || 'en-US',
            adventureSettings: {
                worldStyle: userAdventure.worldStyle as WorldStyle,
                toneStyle: userAdventure.toneStyle as ToneStyle,
                magicLevel: userAdventure.magicLevel as MagicLevel,
                setting: userAdventure.setting || undefined
            },
            memory
        };

        // Check if we're already in combat
        const existingCombat = await getCombatState(userAdventure.id);

        // Detect combat triggers in the action
        const { isCombat, type } = await detectCombatTriggers(action);

        if (isCombat) {
            if (!existingCombat && type === 'initiate') {
                // Initialize combat
                const playerCharacters = userAdventure.players.map(p => toGameCharacter(p.character));
                const combat = await initiateCombat(userAdventure.id, playerCharacters);
                
                // Add combat context
                context.combat = {
                    isActive: true,
                    round: combat.round,
                    turnOrder: combat.participants.map(p => p.characterId),
                    currentTurn: combat.participants[combat.currentTurn].characterId,
                    participants: combat.participants.map(p => ({
                        id: p.characterId,
                        initiative: p.initiative,
                        isNPC: p.isNPC,
                        health: p.character.health,
                        maxHealth: p.character.maxHealth,
                        statusEffects: []  // Initialize empty, will be populated by effects system
                    }))
                };
            } else if (existingCombat) {
                // Handle combat action in existing combat
                const combatManager = new CombatManager({
                    id: existingCombat.id,
                    adventureId: existingCombat.adventureId,
                    round: existingCombat.round,
                    currentTurn: existingCombat.currentTurn,
                    status: existingCombat.status as CombatStatus,
                    turnOrder: existingCombat.participants.map(p => p.characterId),
                    participants: existingCombat.participants.map(p => ({
                        id: p.characterId,
                        characterId: p.characterId,
                        character: { ...p.character, class: p.character.class as CharacterClass },
                        initiative: p.initiative,
                        temporaryEffects: [],
                        isNPC: p.isNPC
                    })),
                    log: existingCombat.log.map(entry => ({
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

                // Perform the combat action
                if (type && type !== 'initiate') {
                    await combatManager.performAction(type as CombatAction);
                    const newState = combatManager.getState();
                    
                    // Update combat state in database
                    await prisma.combat.update({
                        where: { id: existingCombat.id },
                        data: {
                            round: newState.round,
                            currentTurn: newState.currentTurn,
                            status: newState.status
                        }
                    });
                }

                // Add current combat state to context
                context.combat = {
                    isActive: true,
                    round: existingCombat.round,
                    turnOrder: existingCombat.participants.map(p => p.characterId),
                    currentTurn: existingCombat.participants[existingCombat.currentTurn].characterId,
                    participants: existingCombat.participants.map(p => ({
                        id: p.characterId,
                        initiative: p.initiative,
                        isNPC: p.isNPC,
                        health: p.character.health,
                        maxHealth: p.character.maxHealth,
                        statusEffects: []
                    })),
                };
            }
        }

        logger.debug('Generating AI response...');
        const response = await generateResponse(context);
        logger.debug('AI response generated');

        // Save the scene
        await prisma.scene.create({
            data: {
                adventureId: userAdventure.id,
                name: `Scene ${Date.now()}`,
                description: response,
                summary: response.split('\n')[0], // First line as summary
                keyEvents: [],
                npcInteractions: JSON.stringify({}),
                decisions: JSON.stringify([action]),
                questProgress: JSON.stringify({}),
                locationContext: currentScene?.locationContext || ''
            }
        });

        // Update adventure memory based on AI response
        await updateAdventureMemory(userAdventure.id, response);
        
        const channel = interaction.channel;
        if (!channel || !(channel instanceof BaseGuildTextChannel)) {
            await interaction.editReply({
                content: 'This command can only be used in a server text channel.',
            });
            return;
        }

        // Extract sections
        const sections = response.split(/\[(?=[A-Z])/);
        
        // Group sections by type
        const narrativeSections = sections.filter(section => 
            section.startsWith('Narration') || 
            section.startsWith('Narração') || 
            section.startsWith('Dialogue') || 
            section.startsWith('Diálogo') || 
            section.startsWith('Atmosphere') ||
            section.startsWith('Atmosfera')
        ).map(section => {
            // Clean up the section text to remove any metadata and malformed content
            const cleanedSection = section.trim()
                .replace(/Characters Present:[\s\S]*?(?=\[|$)/, '')
                .replace(/Current Status:[\s\S]*?(?=\[|$)/, '')
                .replace(/Recent Events:[\s\S]*?(?=\[|$)/, '')
                .replace(/Active Quests:[\s\S]*?(?=\[|$)/, '')
                .replace(/Known Characters:[\s\S]*?(?=\[|$)/, '')
                .replace(/Discovered Locations:[\s\S]*?(?=\[|$)/, '')
                .replace(/Important Items:[\s\S]*?(?=\[|$)/, '')
                .replace(/\[tool_call\][\s\S]*?(?=\[|$)/, '')
                .replace(/\[\]}}.*$/, '') // Remove malformed JSON-like content
                .replace(/The beginning of a new adventure.*$/, ''); // Remove redundant ending
            return `[${cleanedSection}`;
        });

        // Remove duplicate narrative sections
        const uniqueNarrativeSections = Array.from(new Set(narrativeSections));

        const effectsSections = sections.filter(section =>
            section.startsWith('Effects') ||
            section.startsWith('Efeitos')
        ).map(section => {
            // Clean up effects section
            const cleanedSection = section.trim()
                .replace(/\[tool_call\][\s\S]*?(?=\[|$)/, '')
                .replace(/\[\]}}.*$/, '');
            return `[${cleanedSection}`;
        });

        // Extract suggested actions and create buttons
        const suggestedActions = extractSuggestedActions(response, context.language);
        const actionButtons = createActionButtons(suggestedActions);

        // Combine narrative sections into a single message
        const narrativeContent = uniqueNarrativeSections.join('\n\n');
        const effectsContent = effectsSections.join('\n\n');

        // First send the player's action
        await channel.send({
            content: `🎭 **${userCharacter.name}**: ${action}`,
            tts: false
        });

        // Send the combined narrative content
        if (narrativeContent) {
            const sectionType = uniqueNarrativeSections[0]?.match(/\[(Narration|Narração|Dialogue|Diálogo|Atmosphere|Atmosfera)/i)?.[1];
            const emoji = {
                Narration: '��', Narração: '📜',
                Dialogue: '��', Diálogo: '💬', 
                Atmosphere: '☁️', Atmosfera: '☁️'
            }[sectionType] || '📖';

            await channel.send({
                content: `${emoji} ${narrativeContent}\n\n_${getMessages(context.language).actions.customPrompt}_`,
                tts: userAdventure.voiceType === 'discord'
            });
        }

        // Send effects content if present
        if (effectsContent) {
            await channel.send({
                content: effectsContent,
                tts: false
            });
        }

        // Send action buttons in a separate message
        if (actionButtons.length > 0) {
            await channel.send({
                content: context.language === 'pt-BR' ? '**Ações Disponíveis:**' : '**Available Actions:**',
                components: actionButtons,
                tts: false
            });
        }

        // Voice playback if enabled
        if (userAdventure.categoryId && userAdventure.voiceType === 'elevenlabs') {
            try {
                await speakInVoiceChannel(
                    narrativeContent,
                    interaction.guild!,
                    userAdventure.categoryId,
                    userAdventure.id
                );
            } catch (voiceError) {
                logger.error('Error in voice playback:', voiceError);
            }
        }

        // Update the deferred reply
        await interaction.editReply({
            content: '✨ Ação processada!'
        });

    } catch (error) {
        logger.error('Error handling player action:', error);
        if (interaction.deferred) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
            });
        } else {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
                ephemeral: true
            });
        }
    }
} 