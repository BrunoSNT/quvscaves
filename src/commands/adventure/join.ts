import { ChatInputCommandInteraction, Snowflake as ChannelType, TextChannel, PermissionsBitField } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage } from '../../types/game';

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

        const adventure = await prisma.adventure.findFirst({
            where: { 
                id: adventureId,
                status: 'ACTIVE'
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
                name: characterName,
                userId: user.id
            }
        });

        logger.debug('Found character:', character);

        if (!character) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotFound
            });
            return;
        }

        // Create the adventure player record first
        try {
            await prisma.adventurePlayer.create({
                data: {
                    adventureId,
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
                    name: `${character.name.toLowerCase()}`,
                    type: ChannelType.GuildText,
                    parent: adventure.categoryId || undefined,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                        }
                    ],
                    topic: `Private channel for ${character.name}'s actions in ${adventure.name}`
                });

                // Find the adventure-log channel
                const adventureLogChannel = interaction.guild.channels.cache.find(
                    channel => channel.name === 'adventure-log' && 
                              channel.type === ChannelType.GuildText &&
                              channel.parentId === adventure.categoryId
                ) as TextChannel;

                if (!adventureLogChannel) {
                    logger.error('Adventure log channel not found:', { adventureName: adventure.name });
                } else {
                    await adventureLogChannel.send(
                        `🎉 ${character.name} has joined the adventure! Their private channel has been created at ${characterChannel}.`
                    );
                }

                await interaction.editReply({
                    content: `Successfully joined the adventure with ${character.name}! Check your new private channel at ${characterChannel}.`
                });
            } catch (error) {
                logger.error('Error creating channels:', error);
                await interaction.editReply({
                    content: 'Joined the adventure but failed to create channels. Please contact an administrator.'
                });
            }
        } else {
            await interaction.editReply({
                content: `Successfully joined the adventure with ${character.name}!`
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