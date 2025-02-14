import { Guild, CategoryChannel, TextChannel, VoiceChannel, ChannelType, ChatInputCommandInteraction, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import { logger } from '../../shared/logger';
import { prisma } from '../../core/prisma';
import type { Character } from '../../features/character/types';
import { formatCharacterSheet } from './sheet';
import { handlePlayerAction } from '../../features/adventure/commands/action';
import { getMessages } from '../../shared/i18n/translations';
import { SupportedLanguage } from 'shared/i18n/types';

export async function createCategoryChannel(guild: Guild, name: string): Promise<CategoryChannel> {
    return guild.channels.create({
        name,
        type: ChannelType.GuildCategory
    }) as Promise<CategoryChannel>;
}

export async function createTextChannel(category: CategoryChannel, name: string): Promise<TextChannel> {
    return category.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id
    }) as Promise<TextChannel>;
}

type CharacterWithUser = Awaited<ReturnType<typeof prisma.character.findFirst>> & {
    user: { discordId: string }
};

export async function createPlayerChannels(category: CategoryChannel, characters: CharacterWithUser[]): Promise<TextChannel[]> {
    const channels: TextChannel[] = [];

    try {
        for (const character of characters) {
            // Create a text channel for the character with permission overwrites:
            // - Deny everyone from viewing the channel.
            // - Allow the bot full access.
            // - Allow the specific player (by discordId) to view and send messages.
            const channel = await category.guild.channels.create({
                name: character.name.toLowerCase().replace(/\s+/g, '-'),
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: [
                    {
                        id: category.guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: category.guild.client.user!.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ManageChannels,
                            PermissionsBitField.Flags.ManageRoles
                        ]
                    },
                    {
                        id: character.user.discordId,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    }
                ]
            }) as TextChannel;

            // Fetch the character record.
            // Removed "include" since spells, abilities, and inventory are scalar JSON fields.
            const char = await prisma.character.findUnique({
                where: { id: character.id }
            });

            if (char) {
                await updateCharacterSheet(char as unknown as Character, channel);
            }

            channels.push(channel);
        }
    } catch (error) {
        logger.error('Error creating player channels:', {
            error: error instanceof Error 
                ? { message: error.message, name: error.name, stack: error.stack } 
                : error,
            guildId: category.guild.id,
            categoryId: category.id,
            adventureName: category.name
        });
    }

    return channels;
}

export async function createVoiceChannel(category: CategoryChannel, name: string): Promise<VoiceChannel> {
    return category.guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category.id
    }) as Promise<VoiceChannel>;
}

export async function deleteVoiceChannel(channel: VoiceChannel): Promise<void> {
    await channel.delete();
}

export async function deleteCategoryChannels(interaction: ChatInputCommandInteraction, adventure: any): Promise<void> {
    const categoryChannel = interaction.guild?.channels.cache.get(adventure.categoryId);
    if (categoryChannel) {
        // Delete any child channels (text, voice, player channels) under the category
        const childChannels = interaction.guild?.channels.cache.filter(ch => ch.parentId === adventure.categoryId);
        for (const child of childChannels?.values() ?? []) {
            await child.delete().catch(err => {
                logger.error(`Error deleting child channel ${child.id}: ${err}`);
            });
        }
        // Delete the category channel itself
        await categoryChannel.delete().catch(err => {
            logger.error(`Error deleting category channel ${categoryChannel.id}: ${err}`);
        });
    }
}

export async function deleteTextChannel(channel: TextChannel): Promise<void> {
    await channel.delete();
}

/**
 * Updates (or creates) the character sheet embed in the player's channel.
 * The embed is generated by the formatCharacterSheet function so that it
 * matches the look defined in your codebase.
 */
export async function updateCharacterSheet(
  character: Character,
  channel: TextChannel,
): Promise<void> {
  try {
    // Create an embed for the character sheet using the provided formatCharacterSheet function.
    const sheetEmbed: EmbedBuilder = formatCharacterSheet(character);
  
    // Fetch pinned messages in the channel to detect if a sheet was already sent.
    const pinnedMessages = await channel.messages.fetchPinned();
    const existingSheet = pinnedMessages.find(message =>
      message.author.id === channel.client.user!.id &&
      message.embeds.length > 0 &&
      message.embeds[0].title === character.name
    );
    
    if (existingSheet) {
      // Update the existing pinned message with the new embed.
      await existingSheet.edit({ embeds: [sheetEmbed] });
    } else {
      // Send a new message with the embed and pin it.
      const sheetMessage = await channel.send({ embeds: [sheetEmbed] });
      await sheetMessage.pin();
    }
  } catch (error) {
    logger.error(`Error updating character sheet for ${character.name}:`, error);
  }
}

export async function startAdventure(interaction: ChatInputCommandInteraction, adventure: any, characters: Character[], language: string): Promise<void> {
    // Fetch the adventure-log channel (make sure adventure.logChannelId exists)
    const adventureLogChannel = await interaction.guild?.channels.fetch(adventure.logChannelId) as TextChannel;

    const supportedLanguage: SupportedLanguage = language as SupportedLanguage;

    const welcomeMessage = supportedLanguage === 'pt-BR'
        ? `${getMessages(supportedLanguage).welcome.initialMessage(interaction.user.username)}\n\nUse \`/action\` para descrever sua primeira ação na aventura!\nPor exemplo: \`/action Eu observo os arredores com cautela, procurando por sinais de perigo.\`\n\nOu clique no botão abaixo para uma introdução padrão:\n`
        : `${getMessages(supportedLanguage).welcome.initialMessage(interaction.user.username)}\n\nUse \`/action\` to describe your first action in the adventure!\nFor example: \`/action I carefully observe my surroundings, looking for any signs of danger.\`\n\nOr click the button below for a default introduction:\n`;

    const startButton = new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('start_adventure_action')
                .setLabel(language === 'pt-BR' ? 'Iniciar Aventura' : 'Start Adventure')
                .setStyle(1)
                .setEmoji('⚔️')
        );


    await adventureLogChannel.send({ content: welcomeMessage, components: [startButton] });
    await adventureLogChannel.send(getMessages(supportedLanguage).welcome.newPlayer(characters.map((c: Character) => c.name).join(', ')));

    // Add a button collector to the adventure-log channel message
    const collector = adventureLogChannel.createMessageComponentCollector({ 
        filter: i => i.customId === 'start_adventure_action',
        time: 24 * 60 * 60 * 1000 // 24 hours
    });

    collector.on('collect', async i => {
        try {
            await i.deferReply({ ephemeral: true });
            const userCharacter = characters.find(c => c.user?.id === i.user.id);
            if (!userCharacter) {
                await i.editReply({ 
                    content: language === 'pt-BR' 
                        ? 'Você não tem um personagem nesta aventura.'
                        : 'You don\'t have a character in this adventure.'
                });
                return;
            }
            const defaultAction = language === 'pt-BR'
                ? 'Eu observo atentamente o ambiente ao meu redor, tentando absorver cada detalhe deste novo começo.'
                : 'I carefully observe my surroundings, taking in every detail of this new beginning.';

            
            const actionInteraction = {
                ...i,
                commandName: 'action',
                options: {
                    getString: (name: string) => {
                        if (name === 'description') return defaultAction;
                        if (name === 'adventureId') return adventure.id;
                        return null;
                    }
                },
                deferReply: async () => Promise.resolve(),
                editReply: i.editReply.bind(i),
                followUp: i.followUp.bind(i),
                replied: false,
                deferred: true,
                locale: language
            };

            await handlePlayerAction(actionInteraction as any);
            await i.editReply({ 
                content: language === 'pt-BR'
                    ? '✨ Aventura iniciada! Sua jornada começa...'
                    : '✨ Adventure started! Your journey begins...'
            });

            const originalMessage = await i.message.fetch();
            if (originalMessage.components.length > 0) {
                await originalMessage.edit({ components: [] });
            }
        } catch (error) {
            logger.error('Error in collector:', error);
            try {
                if (i.deferred) {
                    await i.editReply({
                        content: language === 'pt-BR'
                            ? 'Erro ao processar a ação. Por favor, tente novamente.'
                            : 'Error processing action. Please try again.'
                    });
                } else {
                    await i.reply({
                        content: language === 'pt-BR'
                            ? 'Erro ao processar a ação. Por favor, tente novamente.'
                            : 'Error processing action. Please try again.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error('Error sending error message:', replyError);
            }
        }
    });
}