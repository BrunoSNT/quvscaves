import { ChatInputCommandInteraction, MessagePayload, InteractionReplyOptions, TextChannel, DMChannel, NewsChannel, ThreadChannel, BaseGuildTextChannel } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage, GameContext, GameState, CharacterClass, Character } from '../../types/game';
import { generateResponse } from '../../ai/gamemaster';
import { speakInVoiceChannel } from '../../lib/voice';
import { updateCharacterSheet, StatusEffect, ParsedEffects } from '../../utils';

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

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        // Defer reply immediately since we'll be doing async operations
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

        const context: GameContext = {
            scene: currentScene?.description || 'Starting a new adventure...',
            playerActions: [action],
            characters: userAdventure.players.map(p => toGameCharacter(p.character)),
            currentState: gameState,
            language: (userAdventure.language as SupportedLanguage) || 'en-US'
        };

        logger.debug('Generating AI response...');
        const response = await generateResponse(context);
        logger.debug('AI response generated');
        
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
                    logger.error('Voice playback error:', voiceError);
                }
            }
        }

        // Send mechanic sections without voice
        if (mechanicSections.length > 0) {
            await channel.send({
                content: mechanicSections.join('\n\n'),
                tts: false
            });

            // Parse effects from the [Effects] section
            const effectsSection = mechanicSections.find(section => 
                section.startsWith('[Effects]') || 
                section.startsWith('[Efeitos]')
            );

            if (effectsSection) {
                const { 
                    statusEffects, 
                    healthChange, 
                    manaChange, 
                    experienceChange,
                    absoluteHealth,
                    absoluteMana
                } = parseEffects(effectsSection);
                
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