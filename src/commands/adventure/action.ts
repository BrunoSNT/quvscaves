import { ChatInputCommandInteraction, MessagePayload, InteractionReplyOptions, TextChannel, DMChannel, NewsChannel, ThreadChannel, BaseGuildTextChannel } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage, GameContext, GameState, CharacterClass } from '../../types/game';
import { generateResponse } from '../../ai/gamemaster';
import { speakInVoiceChannel } from '../../lib/voice';

type AdventurePlayerWithCharacter = {
    adventureId: string;
    characterId: string;
    character: {
        userId: string;
        id: string;
        name: string;
        health: number;
        mana: number;
        class: string;
        level: number;
        experience: number;
        user: {
            discordId: string;
        };
    }
};

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
                                user: true
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
            characters: userAdventure.players.map((p: AdventurePlayerWithCharacter) => ({
                ...p.character,
                class: p.character.class as CharacterClass,
                level: p.character.level || 1,
                experience: p.character.experience || 0
            })),
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