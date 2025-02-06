import { ChatInputCommandInteraction, MessagePayload, InteractionReplyOptions, TextChannel, DMChannel, NewsChannel, ThreadChannel, BaseGuildTextChannel } from 'discord.js';
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

function parseEffects(effectsText: string): ParsedEffects {
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

function toGameCharacter(dbChar: any): Character {
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

async function getAdventureMemory(adventureId: string) {
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

    // Organize memories by type
    const significantMemories = memories.filter(m => m.importance >= 4);
    const activeQuests = memories.filter(m => m.type === 'QUEST' && m.status === 'ACTIVE');
    const knownCharacters = memories.filter(m => m.type === 'CHARACTER');
    const discoveredLocations = memories.filter(m => m.type === 'LOCATION');
    const importantItems = memories.filter(m => m.type === 'ITEM');

    return {
        currentScene: scenes[0] ? {
            description: scenes[0].description,
            summary: scenes[0].summary,
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
            description: scene.description,
            summary: scene.summary,
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

        // First send the player's action without TTS
        await channel.send({
            content: `🎭 **${userCharacter.name}**: ${action}`,
            tts: false,
        });

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
        ).map(section => `[${section.trim()}`);

        const mechanicSections = sections.filter(section =>
            section.startsWith('Suggested Choices') ||
            section.startsWith('Sugestões de Ação') ||
            section.startsWith('Effects') ||
            section.startsWith('Efeitos')
        ).map(section => `[${section.trim()}`);

        // Send narrative sections based on voice type
        for (const section of narrativeSections) {
            // Send text message
            await channel.send({
                content: section,
                tts: userAdventure.voiceType === 'discord'
            });

            // Use ElevenLabs if selected
            if (userAdventure.voiceType === 'elevenlabs' && userAdventure.categoryId) {
                try {
                    await speakInVoiceChannel(
                        section.replace(/\[.*?\]/g, '').trim(),
                        interaction.guild!,
                        userAdventure.categoryId,
                        userAdventure.id
                    );
                } catch (voiceError) {
                    logger.error('Error in voice playback:', voiceError);
                }
            }
            // No additional handling needed for text_only, as we already sent the text message
        }

        // Send mechanic sections without voice
        if (mechanicSections.length > 0) {
            await channel.send({
                content: mechanicSections.join('\n\n'),
                tts: false
            });

            // Parse effects from the [Effects] and [Combat Effects] sections
            const effectsSection = mechanicSections.find(section => 
                section.startsWith('[Effects]') || 
                section.startsWith('[Efeitos]')
            );

            const combatEffectsSection = mechanicSections.find(section =>
                section.startsWith('[Combat Effects]') ||
                section.startsWith('[Efeitos de Combate]')
            );

            if (effectsSection || combatEffectsSection) {
                const { 
                    statusEffects, 
                    healthChange, 
                    manaChange, 
                    experienceChange,
                    absoluteHealth,
                    absoluteMana,
                    combatAction
                } = parseEffects(effectsSection + '\n' + (combatEffectsSection || ''));
                
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
                                currentTurn: state.currentTurn,
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
                    
                    // Handle health changes
                    if (absoluteHealth !== undefined) {
                        updateData.health = Math.min(absoluteHealth, userCharacter.maxHealth);
                    } else if (healthChange) {
                        updateData.health = Math.min(
                            userCharacter.maxHealth,
                            Math.max(0, userCharacter.health + healthChange)
                        );
                    }
                    
                    // Handle mana changes
                    if (absoluteMana !== undefined) {
                        updateData.mana = Math.min(absoluteMana, userCharacter.maxMana);
                    } else if (manaChange) {
                        updateData.mana = Math.min(
                            userCharacter.maxMana,
                            Math.max(0, userCharacter.mana + manaChange)
                        );
                    }

                    // Handle experience changes
                    if (experienceChange) {
                        updateData.experience = Math.max(0, userCharacter.experience + experienceChange);
                    }

                    // Update character in database
                    const updatedCharacter = await prisma.character.update({
                        where: { id: userCharacter.id },
                        data: updateData
                    });
                    
                    // Update local character object
                    Object.assign(userCharacter, updatedCharacter);
                }

                // Find and update character sheet
                const characterChannel = interaction.guild!.channels.cache.find(
                    channel => 
                        channel.name === userCharacter.name.toLowerCase().replace(/\s+/g, '-') &&
                        channel.parentId === userAdventure.categoryId
                ) as TextChannel;

                if (characterChannel) {
                    await updateCharacterSheet(userCharacter, characterChannel, statusEffects);
                }
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