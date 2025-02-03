import { ChatInputCommandInteraction, ChannelType, CategoryChannel } from 'discord.js';
import { prisma } from '../lib/prisma';
import { generateResponse } from '../ai/gamemaster';
import { getMessages, SupportedLanguage } from '../utils/language';
import { GameContext } from '../types/game';
import { speakInVoiceChannel, disconnectVoice } from '../lib/voice';

export async function handleStartAdventure(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get selected characters from the command options
        const selectedCharacterNames = interaction.options.getString('players', true).split(',');

        // Get user's friends
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                friends: {
                    where: { status: 'ACCEPTED' },
                    include: { friend: true }
                }
            }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first.'
            });
            return;
        }

        // Get friend IDs including the user's own ID
        const allowedUserIds = [user.id, ...user.friends.map(f => f.friend.id)];

        // Find characters by name belonging to friends
        const characters = await prisma.character.findMany({
            where: {
                name: { in: selectedCharacterNames },
                userId: { in: allowedUserIds }
            },
            include: {
                user: true
            }
        });

        if (characters.length === 0) {
            await interaction.editReply({
                content: 'No valid characters selected.'
            });
            return;
        }

        // Create the adventure
        const adventure = await prisma.adventure.create({
            data: {
                name: `${characters[0].name}'s Quest`,
                status: 'ACTIVE',
                userId: user.id,
                players: {
                    create: characters.map(char => ({
                        characterId: char.id
                    }))
                }
            }
        });

        // Create category and channels
        const referenceCategory = interaction.guild?.channels.cache.get('1335320205055885354') as CategoryChannel;
        
        const adventureCategory = await interaction.guild?.channels.create({
            name: getMessages(adventure.language as SupportedLanguage).channels.categoryName(adventure.name),
            type: ChannelType.GuildCategory,
            position: referenceCategory.position + 1
        });

        // Create standard channels
        const msgs = getMessages(adventure.language as SupportedLanguage);
        const textChannel = await interaction.guild?.channels.create({
            name: msgs.channels.adventureLog,
            type: ChannelType.GuildText,
            parent: adventureCategory?.id
        });

        const diceChannel = await interaction.guild?.channels.create({
            name: msgs.channels.dice,
            type: ChannelType.GuildText,
            parent: adventureCategory?.id
        });

        // Create player-specific channels
        for (const character of characters) {
            await interaction.guild?.channels.create({
                name: character.name.toLowerCase().replace(/\s+/g, '-'),
                type: ChannelType.GuildText,
                parent: adventureCategory?.id,
                permissionOverwrites: [
                    {
                        id: character.user.discordId,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.user.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel']
                    }
                ]
            });
        }

        // Update adventure without voice channel ID
        await prisma.adventure.update({
            where: { id: adventure.id },
            data: {
                textChannelId: textChannel?.id,
                categoryId: adventureCategory?.id
            }
        });

        // Create initial scene with localized content
        const initialScene = await prisma.scene.create({
            data: {
                name: msgs.defaultScenes.beginning.name,
                description: msgs.defaultScenes.beginning.description,
                adventureId: adventure.id
            }
        });

        try {
            // Generate initial narrative using AI
            const context: GameContext = {
                scene: initialScene.description,
                playerActions: [],
                characters: characters,
                currentState: {
                    health: 100,
                    mana: 100,
                    inventory: [],
                    questProgress: 'STARTING'
                },
                language: adventure.language as 'en-US' | 'pt-BR'
            };

            const response = await generateResponse(context);
            await textChannel?.send({
                content: getMessages(adventure.language as SupportedLanguage).welcome.initialMessage(interaction.user.username) + '\n\n' + response
            });
        } catch (aiError) {
            console.error('AI Error:', aiError);
            await textChannel?.send({
                content: getMessages(adventure.language as SupportedLanguage).defaultScenes.beginning.description
            });
        }

        await interaction.editReply({
            content: getMessages(adventure.language as SupportedLanguage).success.adventureStarted
        });

    } catch (error) {
        console.error('Error starting adventure:', error);
        await interaction.editReply({
            content: 'Failed to start adventure. Please try again.'
        }).catch(console.error);
    }
}

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        // Get user and their character
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                characters: true
            }
        });

        if (!user) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.registerFirst
            });
            return;
        }

        // Find the character
        const character = user.characters.find(c => c.name === characterName);
        if (!character) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.characterNotFound
            });
            return;
        }

        // Find the adventure
        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId },
            include: {
                players: {
                    include: {
                        character: true
                    }
                },
                user: true
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.adventureNotFound
            });
            return;
        }

        // Check if already in the adventure
        const alreadyJoined = adventure.players.some(p => p.character.userId === user.id);
        if (alreadyJoined) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.alreadyInAdventure
            });
            return;
        }

        // Check if adventure owner is a friend
        const friendship = await prisma.friendship.findFirst({
            where: {
                OR: [
                    { userId: user.id, friendId: adventure.userId, status: 'ACCEPTED' },
                    { userId: adventure.userId, friendId: user.id, status: 'ACCEPTED' }
                ]
            }
        });

        if (!friendship) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.friendsOnly
            });
            return;
        }

        // Add player to adventure
        await prisma.adventurePlayer.create({
            data: {
                adventureId: adventure.id,
                characterId: character.id
            }
        });

        // Create player-specific channel
        const category = await interaction.guild?.channels.fetch(adventure.categoryId!);
        if (category?.type === ChannelType.GuildCategory) {
            await interaction.guild?.channels.create({
                name: character.name.toLowerCase().replace(/\s+/g, '-'),
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: interaction.user.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: adventure.user.discordId, // Adventure owner can see all channels
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel']
                    }
                ]
            });
        }

        // Send welcome message to adventure log
        if (adventure.textChannelId) {
            const textChannel = await interaction.guild?.channels.fetch(adventure.textChannelId);
            if (textChannel?.isTextBased()) {
                await textChannel.send({
                    content: getMessages(adventure.language as SupportedLanguage).welcome.newPlayer(character.name)
                });
            }
        }

        await interaction.editReply({
            content: getMessages(adventure.language as SupportedLanguage).success.adventureJoined(adventure.name, character.name)
        });

    } catch (error) {
        console.error('Error joining adventure:', error);
        await interaction.editReply({
            content: getMessages(adventure.language as SupportedLanguage).errors.genericError
        }).catch(console.error);
    }
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: false });
        
        const action = interaction.options.getString('description', true);
        
        // Find user's active adventure
        const adventure = await prisma.adventure.findFirst({
            where: {
                players: {
                    some: {
                        character: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                },
                status: 'ACTIVE'
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
                },
                inventory: true,
                user: true
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.needActiveAdventure
            });
            return;
        }

        // Get the player's character in this adventure
        const playerCharacter = adventure.players.find(p => 
            p.character.user.discordId === interaction.user.id
        )?.character;

        if (!playerCharacter) {
            await interaction.editReply({
                content: getMessages(adventure.language as SupportedLanguage).errors.characterNotInAdventure
            });
            return;
        }

        const context: GameContext = {
            scene: adventure.scenes[0]?.description || 'Continuing the adventure...',
            playerActions: [action],
            characters: adventure.players.map(p => p.character),
            currentState: {
                health: playerCharacter.health,
                mana: playerCharacter.mana,
                inventory: adventure.inventory.map(item => item.name),
                questProgress: adventure.status
            },
            language: adventure.language as 'en-US' | 'pt-BR'
        };

        // Get AI response with error handling
        let response: string;
        try {
            response = await generateResponse(context);
            if (!response) {
                throw new Error('Empty response from AI');
            }
        } catch (aiError) {
            console.error('AI Error:', aiError);
            response = getMessages(adventure.language as SupportedLanguage).defaultScenes.beginning.narration(playerCharacter.name, action);
        }
        
        // Create a new scene with the action and response
        await prisma.scene.create({
            data: {
                name: `${playerCharacter.name}'s Action`,
                description: `**Action**: ${action}\n\n${response}`,
                adventureId: adventure.id
            }
        });

        // Send response to the adventure's text channel
        if (adventure.textChannelId && adventure.categoryId) {
            const textChannel = await interaction.guild?.channels.fetch(adventure.textChannelId);
            if (textChannel?.isTextBased()) {
                // First send the action without TTS
                await textChannel.send({
                    content: `🎭 **${playerCharacter.name}**: ${action}`,
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
                    await textChannel.send({
                        content: section,
                        tts: adventure.voiceType === 'discord'
                    });

                    // Use ElevenLabs if selected
                    if (adventure.voiceType === 'elevenlabs' && interaction.guild) {
                        try {
                            await speakInVoiceChannel(
                                section.replace(/\[.*?\]/g, '').trim(),
                                interaction.guild,
                                adventure.categoryId,
                                adventure.id
                            );
                        } catch (voiceError) {
                            console.error('Voice playback error:', voiceError);
                            // Fallback to Discord TTS if ElevenLabs fails
                            await textChannel.send({
                                content: section,
                                tts: true
                            });
                        }
                    }
                }

                // Send mechanic sections without voice
                if (mechanicSections.length > 0) {
                    await textChannel.send({
                        content: mechanicSections.join('\n\n'),
                        tts: false
                    });
                }
            }
        }

        await interaction.editReply({
            content: '✨ Ação processada!'
        });

    } catch (error) {
        console.error('Error processing action:', error);
        await interaction.editReply({
            content: 'Failed to process action. Please try again.'
        });
    }
}

export async function handleAdventureSettings(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const adventureId = interaction.options.getString('adventure_id', true);
        const rawLanguage = interaction.options.getString('language');
        const voiceType = interaction.options.getString('voice');

        // Find the adventure first
        const adventure = await prisma.adventure.findFirst({
            where: {
                id: adventureId,
                userId: (await prisma.user.findUnique({
                    where: { discordId: interaction.user.id }
                }))?.id
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: 'Adventure not found or you do not have permission to modify it.'
            });
            return;
        }

        // Prepare update data
        const updateData: any = {};

        // Handle language update if provided
        if (rawLanguage) {
            const newLanguage: SupportedLanguage = 
                rawLanguage === 'Português (Brasil)' ? 'pt-BR' : 'en-US';
            updateData.language = newLanguage;
        }

        // Handle voice type update if provided
        if (voiceType) {
            updateData.voiceType = voiceType;
        }

        // Update adventure settings
        const updatedAdventure = await prisma.adventure.update({
            where: { id: adventureId },
            data: updateData
        });

        // Get messages in the current language
        const msgs = getMessages(updatedAdventure.language as SupportedLanguage);

        // Build response message
        let response = msgs.success.settingsUpdated;
        if (voiceType) {
            response += `\n${msgs.success.voiceUpdated(voiceType === 'elevenlabs' ? 'ElevenLabs' : 'Discord TTS')}`;
        }

        // Send confirmation
        await interaction.editReply({
            content: response
        });

    } catch (error) {
        console.error('Error updating adventure settings:', error);
        await interaction.editReply({
            content: 'Failed to update adventure settings. Please try again.'
        });
    }
}

export async function handleDisconnectVoice(interaction: ChatInputCommandInteraction) {
    try {
        if (!interaction.guildId) {
            await interaction.reply({ 
                content: 'This command can only be used in a server', 
                ephemeral: true 
            });
            return;
        }

        disconnectVoice(interaction.guildId);
        await interaction.reply({ 
            content: 'Disconnected from voice channel', 
            ephemeral: true 
        });
    } catch (error) {
        console.error('Error disconnecting from voice:', error);
        await interaction.reply({ 
            content: 'Failed to disconnect from voice channel', 
            ephemeral: true 
        });
    }
} 