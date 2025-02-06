import { 
    ChatInputCommandInteraction, 
    TextChannel,
    PermissionsBitField,
    GuildMember
} from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage } from '../../types/game';
import { updateCharacterSheet } from '../../utils/character';

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        // Defer reply immediately
        await interaction.deferReply({ ephemeral: true });

        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        logger.debug('Join adventure request:', { adventureId, characterName, userId: interaction.user.id });

        // First get the user's internal ID
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        logger.debug('Found user:', user);

        if (!user) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.registerFirst
            });
            return;
        }

        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId },
            include: {
                user: true,
                players: {
                    include: {
                        character: true
                    }
                }
            }
        });

        logger.debug('Found adventure:', adventure);

        if (!adventure) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.adventureNotFound
            });
            return;
        }

        const character = await prisma.character.findFirst({
            where: {
                userId: user.id,
                name: characterName
            },
            include: {
                spells: true,
                abilities: true,
                inventory: true
            }
        });

        logger.debug('Found character:', character);

        if (!character) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotFound
            });
            return;
        }

        // Check if character is already in the adventure
        const existingPlayer = adventure.players.find(p => p.character.id === character.id);

        if (existingPlayer) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.alreadyInAdventure
            });
            return;
        }

        // Check privacy settings
        if (adventure.privacy === 'friends_only') {
            const isFriend = await prisma.friendship.findFirst({
                where: {
                    OR: [
                        { userId: adventure.userId, friendId: user.id },
                        { userId: user.id, friendId: adventure.userId }
                    ],
                    status: 'ACCEPTED'
                }
            });

            if (!isFriend) {
                await interaction.editReply({
                    content: getMessages(interaction.locale as SupportedLanguage).errors.friendsOnly
                });
                return;
            }
        }

        // Create the adventure player record first
        try {
            await prisma.adventurePlayer.create({
                data: {
                    adventureId: adventure.id,
                    characterId: character.id
                }
            });
        } catch (error) {
            logger.error('Error creating adventure player:', error);
            await interaction.editReply({
                content: 'Failed to join the adventure. You might already be in this adventure.'
            });
            return;
        }

        // Then create channels if guild is available
        if (interaction.guild) {
            try {
                const characterChannel = await interaction.guild.channels.create({
                    name: `${character.name.toLowerCase().replace(/\s+/g, '-')}`,
                    type: 0, // GuildText = 0
                    parent: adventure.categoryId || undefined,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel, 
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ReadMessageHistory
                            ]
                        },
                        {
                            id: interaction.client.user!.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.SendMessages,
                                PermissionsBitField.Flags.ManageChannels,
                                PermissionsBitField.Flags.ManageRoles
                            ]
                        }
                    ]
                });

                // Add permissions for the adventure owner after channel is created
                try {
                    const adventureOwner = await interaction.guild.members.fetch(adventure.user.discordId);
                    if (adventureOwner) {
                        await characterChannel.permissionOverwrites.create(adventureOwner, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        });
                    }
                } catch (error) {
                    logger.error('Error setting adventure owner permissions:', {
                        error: error instanceof Error ? { 
                            message: error.message, 
                            name: error.name, 
                            stack: error.stack 
                        } : error,
                        ownerDiscordId: adventure.user.discordId
                    });
                }

                logger.debug('Created character channel:', { channelId: characterChannel.id });

                // Find the adventure-log channel
                const adventureLogChannel = interaction.guild.channels.cache.find(
                    channel => channel.name === 'adventure-log' && 
                              channel.type === 0 && // GuildText = 0
                              channel.parentId === adventure.categoryId
                ) as TextChannel;

                if (!adventureLogChannel) {
                    logger.error('Adventure log channel not found:', { 
                        adventureName: adventure.name,
                        categoryId: adventure.categoryId,
                        availableChannels: interaction.guild.channels.cache
                            .filter(c => c.parentId === adventure.categoryId)
                            .map(c => ({ name: c.name, type: c.type }))
                    });
                } else {
                    // Send a single welcome message
                    await adventureLogChannel.send(
                        getMessages(interaction.locale as SupportedLanguage).welcome.newPlayer(character.name)
                    );
                }

                // Create/update character sheet
                await updateCharacterSheet(character, characterChannel);

                // Only move to voice channel if adventure is not text_only
                if (adventure.voiceType !== 'text_only') {
                    logger.debug('Attempting to move user to voice channel:', {
                        userId: interaction.user.id,
                        adventureId: adventure.id,
                        categoryId: adventure.categoryId,
                        voiceType: adventure.voiceType
                    });

                    const tableVoiceChannel = interaction.guild.channels.cache.find(
                        channel => channel.name === 'Table' && 
                                  channel.parentId === adventure.categoryId
                    );

                    if (tableVoiceChannel && interaction.member && 'voice' in interaction.member) {
                        try {
                            await (interaction.member as GuildMember).voice.setChannel(tableVoiceChannel.id);
                            logger.debug('Moved user to Table voice channel');
                        } catch (error) {
                            logger.error('Failed to move user to Table voice channel:', error);
                            // Inform user they need to manually join
                            await interaction.followUp({
                                content: interaction.locale === 'pt-BR'
                                    ? 'Por favor, entre no canal de voz Table para participar do chat por voz.'
                                    : 'Please join the Table voice channel to participate in voice chat.',
                                ephemeral: true
                            });
                        }
                    } else {
                        logger.error('Could not find Table voice channel or member is not in voice:', {
                            tableChannelFound: !!tableVoiceChannel,
                            memberHasVoice: !!(interaction.member && 'voice' in interaction.member),
                            categoryId: adventure.categoryId,
                            availableChannels: interaction.guild.channels.cache
                                .filter(c => c.parentId === adventure.categoryId)
                                .map(c => ({ name: c.name, type: c.type }))
                        });
                    }
                }

                await interaction.editReply({
                    content: getMessages(interaction.locale as SupportedLanguage).success.adventureJoined(
                        adventure.name,
                        character.name
                    )
                });
            } catch (error) {
                logger.error('Error creating channels:', { 
                    error: error instanceof Error ? { 
                        message: error.message, 
                        name: error.name, 
                        stack: error.stack 
                    } : error,
                    guildId: interaction.guild.id,
                    categoryId: adventure.categoryId,
                    characterName: character.name,
                    adventureName: adventure.name
                });
                await interaction.editReply({
                    content: 'Joined the adventure but failed to create channels. Please contact an administrator.'
                });
            }
        } else {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).success.adventureJoined(
                    adventure.name,
                    character.name
                )
            });
        }

    } catch (error) {
        logger.error('Error joining adventure:', error);
        if (interaction.deferred) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.genericError
            });
        }
    }
} 