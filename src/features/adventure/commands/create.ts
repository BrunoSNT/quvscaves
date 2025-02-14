import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonInteraction,
    StringSelectMenuInteraction,
    MessageActionRowComponentBuilder,
    ChannelType,
    GuildMember,
    User
} from 'discord.js';
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { logger } from '../../../shared/logger';
import { WorldStyle, ToneStyle, MagicLevel, AdventurePrivacy } from '../../../shared/types/game';
import { AdventureSettings } from '../types';
import { prisma } from '../../../core/prisma';
import { VoiceType } from '../../../shared/types/game';
import { createCategoryChannel, createTextChannel, createPlayerChannels } from '../../../shared/discord/channels';
import { KOKORO_VOICES_BY_LANGUAGE, VOICE_DESCRIPTIONS } from '../../../features/voice/config/voice';
import { SupportedLanguage } from '../../../shared/i18n/types';
import { getMessages } from '../../../shared/i18n/translations';
import { Character } from '@prisma/client';

export async function handleCreateAdventure(interaction: ChatInputCommandInteraction) {
    // Look up the database user based on their Discord ID
    const dbUser = await prisma.user.findUnique({
        where: { discordId: interaction.user.id },
    });
    if (!dbUser) {
        await interaction.reply({
            content: 'You must register first using /register.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    // Use the database user id (UUID) instead of Discord ID
    const userId = dbUser.id;
    logger.info(`Starting adventure creation for user ${userId}`);

    try {
        logger.info('Deferring reply...');
        await interaction.deferReply({ ephemeral: true });
        logger.info('Reply deferred successfully');

        logger.info('Getting characters input...');
        const charactersInput = interaction.options.getString('players', true);
        logger.info(`Received characters input: ${charactersInput}`);

        // Validate characters input
        if (!charactersInput.trim()) {
            logger.warn(`Invalid characters input from user ${userId}: empty input`);
            await interaction.editReply({
                content: 'Please provide at least one character ID.'
            });
            return;
        }

        const characterIds = charactersInput
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);

        logger.info(`Parsed character IDs: ${JSON.stringify(characterIds)}`);

        if (characterIds.length === 0) {
            logger.warn(`Invalid characters input from user ${userId}: no valid IDs after parsing`);
            await interaction.editReply({
                content: 'Please provide valid character IDs.'
            });
            return;
        }

        // Verify characters exist and get their users
        const characters = await prisma.character.findMany({
            where: {
                id: {
                    in: characterIds
                }
            },
            include: {
                user: true
            }
        });

        logger.info(`Found ${characters.length} characters`);

        if (characters.length !== characterIds.length) {
            logger.warn(`Not all characters found. Expected ${characterIds.length}, found ${characters.length}`);
            await interaction.editReply({
                content: 'One or more character IDs are invalid.'
            });
            return;
        }

        // Step 1: Language Selection
        const languageRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('language_select')
                    .setPlaceholder('Choose adventure language')
                    .addOptions([
                        {
                            label: 'English (US)',
                            value: 'en-US',
                            description: 'Use English for this adventure'
                        },
                        {
                            label: 'Português (Brasil)',
                            value: 'pt-BR',
                            description: 'Use Portuguese for this adventure'
                        }
                    ])
            );

        const setupMsg = await interaction.editReply({
            content: 'Setting up your adventure...\nFirst, choose the language:',
            components: [languageRow]
        });

        try {
            const languageInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const language = languageInteraction.values[0] as SupportedLanguage;

            // Step 2: World Style Selection
            const worldStyleRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('world_style_select')
                        .setPlaceholder('Choose world style')
                        .addOptions([
                            {
                                label: 'High Fantasy',
                                value: 'high_fantasy',
                                description: 'Classic D&D-style fantasy world'
                            },
                            {
                                label: 'Dark Fantasy',
                                value: 'dark_fantasy',
                                description: 'Darker themes, more dangerous world'
                            },
                            {
                                label: 'Steampunk',
                                value: 'steampunk',
                                description: 'Technology and magic mix'
                            },
                            {
                                label: 'Medieval',
                                value: 'medieval',
                                description: 'Low magic, historical feel'
                            },
                            {
                                label: 'Mythological',
                                value: 'mythological',
                                description: 'Based on real-world mythology'
                            },
                            {
                                label: 'Post-Apocalyptic',
                                value: 'post_apocalyptic',
                                description: 'Ruined fantasy world'
                            }
                        ])
                );

            await languageInteraction.update({
                content: `Language set to: ${language === 'en-US' ? 'English (US)' : 'Português (Brasil)'}\nNow, choose your world style:`,
                components: [worldStyleRow]
            });

            const worldStyleInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const worldStyle = worldStyleInteraction.values[0] as WorldStyle;

            // Step 3: Tone Style Selection
            const toneStyleRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('tone_style_select')
                        .setPlaceholder('Choose adventure tone')
                        .addOptions([
                            {
                                label: 'Heroic',
                                value: 'heroic',
                                description: 'Epic hero\'s journey'
                            },
                            {
                                label: 'Gritty',
                                value: 'gritty',
                                description: 'Realistic and harsh'
                            },
                            {
                                label: 'Humorous',
                                value: 'humorous',
                                description: 'Light-hearted and funny'
                            },
                            {
                                label: 'Mysterious',
                                value: 'mysterious',
                                description: 'Focus on intrigue and secrets'
                            },
                            {
                                label: 'Horror',
                                value: 'horror',
                                description: 'Scary and suspenseful'
                            },
                            {
                                label: 'Political',
                                value: 'political',
                                description: 'Focus on intrigue and power'
                            }
                        ])
                );

            await worldStyleInteraction.update({
                content: `World style set to: ${worldStyle.replace(/_/g, ' ')}\nNow, choose your adventure tone:`,
                components: [toneStyleRow]
            });

            const toneStyleInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const toneStyle = toneStyleInteraction.values[0] as ToneStyle;

            // Step 4: Magic Level Selection
            const magicLevelRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('magic_level_select')
                        .setPlaceholder('Choose magic level')
                        .addOptions([
                            {
                                label: 'High Magic',
                                value: 'high',
                                description: 'Magic is common and powerful'
                            },
                            {
                                label: 'Medium Magic',
                                value: 'medium',
                                description: 'Magic exists but is limited'
                            },
                            {
                                label: 'Low Magic',
                                value: 'low',
                                description: 'Magic is rare and mysterious'
                            },
                            {
                                label: 'No Magic',
                                value: 'none',
                                description: 'No magic, purely mundane world'
                            }
                        ])
                );

            await toneStyleInteraction.update({
                content: `Adventure tone set to: ${toneStyle}\nNow, choose the level of magic in your world:`,
                components: [magicLevelRow]
            });

            const magicLevelInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const magicLevel = magicLevelInteraction.values[0] as MagicLevel;

            // Step 5: Voice Type Selection
            const voiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('voice_select')
                        .setPlaceholder('Choose voice type')
                        .addOptions([
                            {
                                label: 'None',
                                value: 'none',
                                description: VOICE_DESCRIPTIONS.none
                            },
                            {
                                label: 'Discord TTS',
                                value: 'discord',
                                description: VOICE_DESCRIPTIONS.discord
                            },
                            {
                                label: 'ElevenLabs',
                                value: 'elevenlabs',
                                description: VOICE_DESCRIPTIONS.elevenlabs
                            },
                            {
                                label: 'Kokoro',
                                value: 'kokoro',
                                description: VOICE_DESCRIPTIONS.kokoro
                            }
                        ])
                );

            await magicLevelInteraction.update({
                content: `Magic level set to: ${magicLevel}\nNow, choose the voice type:`,
                components: [voiceRow]
            });

            const voiceInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            const voiceType = voiceInteraction.values[0] as VoiceType;

            // Step 6: Privacy Settings
            const privacyRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('public')
                        .setLabel('Public')
                        .setStyle(1),
                    new ButtonBuilder()
                        .setCustomId('friends_only')
                        .setLabel('Friends Only')
                        .setStyle(2),
                    new ButtonBuilder()
                        .setCustomId('private')
                        .setLabel('Private')
                        .setStyle(2)
                );

            // If Kokoro is selected, show voice options based on language
            let kokoroVoice: string | undefined;
            if (voiceType === 'kokoro') {
                const voiceOptions = [...(KOKORO_VOICES_BY_LANGUAGE[language] || KOKORO_VOICES_BY_LANGUAGE['en-US'])];

                const kokoroVoiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('kokoro_voice_select')
                            .setPlaceholder('Choose Kokoro voice')
                            .addOptions(voiceOptions)
                    );

                await voiceInteraction.update({
                    content: 'Choose a Kokoro voice:',
                    components: [kokoroVoiceRow]
                });

                const kokoroVoiceInteraction = await setupMsg.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id,
                    time: 300000
                }) as StringSelectMenuInteraction;

                kokoroVoice = kokoroVoiceInteraction.values[0];

                await kokoroVoiceInteraction.update({
                    content: `Voice type set to: Kokoro (${kokoroVoice})\nLastly, choose the privacy setting:`,
                    components: [privacyRow]
                });
            } else {
                await voiceInteraction.update({
                    content: `Voice type set to: ${voiceType}\nLastly, choose the privacy setting:`,
                    components: [privacyRow]
                });
            }

            const privacyInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as ButtonInteraction;

            const privacy = privacyInteraction.customId as AdventurePrivacy;

            // Create channels
            await privacyInteraction.update({
                content: 'Creating adventure channels...',
                components: []
            });

            if (!interaction.guild) {
                throw new Error('This command can only be used in a server');
            }

            const adventureName = `adventure-${Date.now()}`;
            const category = await createCategoryChannel(interaction.guild, adventureName);
            if (!category) {
                throw new Error('Failed to create category channel');
            }

            const textChannel = await createTextChannel(category, 'adventure-log');
            if (!textChannel) {
                throw new Error('Failed to create text channel');
            }

            // Create player channels
            const playerChannels = await createPlayerChannels(category, characters);
            if (playerChannels.length === 0) {
                throw new Error('Failed to create player channels');
            }


            // Create a voice channel called "Table" under the adventure category
            const tableVoiceChannel = await interaction.guild.channels.create({
                name: 'Table',
                type: ChannelType.GuildVoice,
                parent: category.id, // if you want it under the same category
            });
            if (!tableVoiceChannel) {
                return await interaction.editReply('Failed to create voice channel');
            }

            // Move the player to the new voice channel if they are connected
            if (interaction.member instanceof GuildMember && interaction.member.voice?.channel) {
                await interaction.member.voice.setChannel(tableVoiceChannel);
            } else {
                // Optionally, inform the user to join a voice channel if they're not connected
                await interaction.followUp({
                    content: 'Please join a voice channel to be moved to the Table channel.',
                    ephemeral: true
                });
            }
            // Create the adventure with all settings
            const adventure = await prisma.adventure.create({
                data: {
                    name: adventureName,
                    status: 'ACTIVE',
                    language,
                    voiceType,
                    privacy,
                    worldStyle,
                    toneStyle,
                    magicLevel,
                    userId: dbUser.id,
                    categoryId: category.id,
                    textChannelId: textChannel.id,
                    settings: {
                        kokoroVoice
                    },
                    players: {
                        create: characters.map(char => ({
                            userId: char.userId,
                            characterId: char.id,
                            username: char.user.username
                        }))
                    }
                },
                include: {
                    players: {
                        include: {
                            user: true,
                            character: true
                        }
                    }
                }
            });

            // Set up channel permissions
            const allUserDiscordIds = [...characters.map(c => c.user.discordId), interaction.user.id];
            for (const discordId of allUserDiscordIds) {
                await category.permissionOverwrites.create(discordId, {
                    ViewChannel: true,
                    Connect: true,
                    Stream: true,
                    Speak: true
                });

                await textChannel.permissionOverwrites.create(discordId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
            }

            // Send welcome message
            const welcomeMessage = language === 'pt-BR'
                ? `${getMessages(language).welcome.initialMessage(interaction.user.username)}\n\nUse \`/action\` para descrever sua primeira ação na aventura!\nPor exemplo: \`/action Eu observo os arredores com cautela, procurando por sinais de perigo.\`\n\nOu clique no botão abaixo para uma introdução padrão:\n`
                : `${getMessages(language).welcome.initialMessage(interaction.user.username)}\n\nUse \`/action\` to describe your first action in the adventure!\nFor example: \`/action I carefully observe my surroundings, looking for any signs of danger.\`\n\nOr click the button below for a default introduction:\n`;

            const startButton = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('start_adventure_action')
                        .setLabel(language === 'pt-BR' ? 'Iniciar Aventura' : 'Start Adventure')
                        .setStyle(1)
                        .setEmoji('⚔️')
                );

            await textChannel.send({ content: welcomeMessage, components: [startButton] });
            await textChannel.send(getMessages(language).welcome.newPlayer(characters.map((c: Character) => c.name).join(', ')));

            // Add button collector
            const collector = textChannel.createMessageComponentCollector({ 
                filter: i => i.customId === 'start_adventure_action',
                time: 24 * 60 * 60 * 1000 // 24 hours
            });

            collector.on('collect', async i => {
                try {
                    // First defer the reply
                    await i.deferReply({ ephemeral: true });

                    // Get the character of the user who clicked
                    const userCharacter = characters.find(c => c.user.discordId === i.user.id);
                    if (!userCharacter) {
                        await i.editReply({ 
                            content: language === 'pt-BR' 
                                ? 'Você não tem um personagem nesta aventura.'
                                : 'You don\'t have a character in this adventure.'
                        });
                        return;
                    }

                    // Default action based on language
                    const defaultAction = language === 'pt-BR'
                        ? 'Eu observo atentamente o ambiente ao meu redor, tentando absorver cada detalhe deste novo começo.'
                        : 'I carefully observe my surroundings, taking in every detail of this new beginning.';

                    try {
                        // Import and call handlePlayerAction
                        const { handlePlayerAction } = await import('./action');
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
                            user: i.user,
                            guild: i.guild,
                            channel: i.channel,
                            client: i.client,
                            reply: async (data: any) => {
                                return i.editReply(data);
                            },
                            deferReply: async () => Promise.resolve(),
                            editReply: i.editReply.bind(i),
                            followUp: i.followUp.bind(i),
                            replied: true,
                            deferred: true,
                            locale: language
                        };
                        
                        // Handle the action
                        await handlePlayerAction(actionInteraction as any);
                        
                        // Edit the deferred reply with success message
                        await i.editReply({ 
                            content: language === 'pt-BR'
                                ? '✨ Aventura iniciada! Sua jornada começa...'
                                : '✨ Adventure started! Your journey begins...'
                        });

                        // Remove the button after successful use
                        const originalMessage = await i.message.fetch();
                        if (originalMessage.components.length > 0) {
                            await originalMessage.edit({ components: [] });
                        }
                    } catch (error) {
                        logger.error('Error executing default action:', error);
                        await i.editReply({ 
                            content: language === 'pt-BR'
                                ? 'Erro ao iniciar a aventura. Por favor, tente usar o comando `/action` manualmente.'
                                : 'Error starting the adventure. Please try using the `/action` command manually.'
                        });
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

            const embed = new EmbedBuilder()
                .setTitle('🎲 Adventure Created!')
                .setDescription(`Your adventure "${adventure.name}" has been created.`)
                .addFields(
                    { name: 'Adventure ID', value: adventure.id, inline: true },
                    { name: 'Players', value: characters.map(char => `${char.name} (${char.user.username})`).join(', '), inline: true },
                    { name: 'Settings', value: `Language: ${language}\nWorld: ${worldStyle}\nTone: ${toneStyle}\nMagic: ${magicLevel}\nVoice: ${voiceType}${kokoroVoice ? ` (${kokoroVoice})` : ''}\nPrivacy: ${privacy}` }
                );

            await interaction.editReply({
                content: `Adventure created! Head to ${textChannel}`,
                embeds: [embed],
                components: []
            });

        } catch (error) {
            if (error instanceof Error && error.name === 'Error [InteractionCollectorError]') {
                await interaction.editReply({
                    content: 'Adventure creation timed out. Please try again.',
                    components: []
                });
            } else {
                throw error;
            }
        }

    } catch (error) {
        logger.error('Error creating adventure:', {
            userId: interaction.user.id,
            error: error instanceof Error ? {
                message: error.message,
                stack: error.stack
            } : error
        });

        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

        try {
            if (interaction.deferred || interaction.replied) {
                logger.info('Sending error response via editReply...');
                await interaction.editReply({
                    content: `Failed to create adventure: ${errorMessage}`,
                    components: []
                });
            } else {
                logger.info('Sending error response via reply...');
                await interaction.reply({
                    content: `Failed to create adventure: ${errorMessage}`,
                    flags: MessageFlags.Ephemeral
                });
            }
            logger.info('Error response sent successfully');
        } catch (responseError) {
            logger.error('Failed to send error response:', responseError);
        }
    }
}

export async function handleStartAdventure(interaction: ChatInputCommandInteraction) {
    // Defer reply so Discord knows you're processing the command
    await interaction.deferReply({ flags: ['Ephemeral'] });

    if (!interaction.guild) {
        return await interaction.editReply('This command can only be used in a server.');
    }

    try {
        logger.debug('Starting adventure creation process...');

        // Look up the user (along with their characters) by their Discord ID.
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: { characters: true }
        });
        if (!user) {
            return await interaction.editReply('You need to register first using /register');
        }

        // -- Gather Player/Character Names & validate them --
        const playerNames = interaction.options.getString('players')?.split(',').map(name => name.trim()) || [];
        logger.debug('Player names:', playerNames);

        const characters = await prisma.character.findMany({
            where: {
                name: { in: playerNames },
            },
            include: {
                user: true,
                adventures: {
                    where: {
                        adventure: { status: 'ACTIVE' }
                    },
                    include: { adventure: { select: { status: true } } }
                }
            }
        });

        if (characters.length !== playerNames.length) {
            const foundNames = characters.map(c => c.name);
            const missingNames = playerNames.filter(name => !foundNames.includes(name));
            return await interaction.editReply(`Some characters were not found: ${missingNames.join(', ')}`);
        }

        const busyCharacters = characters.filter(c => c.adventures.some(ap => ap.adventure.status === 'ACTIVE'));
        if (busyCharacters.length > 0) {
            return await interaction.editReply(
                `The following characters are already in an adventure: ${busyCharacters.map(c => c.name).join(', ')}`
            );
        }

        // -- Interactive Options: Language, World Style, Tone Style, Magic Level, Voice Type & Privacy --
        // Language Selection
        const languageRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('language_select')
                    .setPlaceholder('Choose adventure language')
                    .addOptions([
                        {
                            label: 'English (US)',
                            value: 'en-US',
                            description: 'Use English for this adventure'
                        },
                        {
                            label: 'Português (Brasil)',
                            value: 'pt-BR',
                            description: 'Use Portuguese for this adventure'
                        }
                    ])
            );

        const setupMsg = await interaction.editReply({
            content: 'Setting up your adventure...\nFirst, choose the language:',
            components: [languageRow]
        });

        const languageInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const language = languageInteraction.values[0] as SupportedLanguage;
        await languageInteraction.update({ content: `Language set to: ${language === 'en-US' ? 'English (US)' : 'Português (Brasil)'}\nNow, choose your world style:`, components: [] });

        // World Style Selection
        const worldStyleRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('world_style_select')
                    .setPlaceholder('Choose world style')
                    .addOptions([
                        { label: 'High Fantasy', value: 'high_fantasy', description: 'Classic D&D-style fantasy world' },
                        { label: 'Dark Fantasy', value: 'dark_fantasy', description: 'Darker themes, more dangerous world' },
                        { label: 'Steampunk', value: 'steampunk', description: 'Technology and magic mix' },
                        { label: 'Medieval', value: 'medieval', description: 'Low magic, historical feel' },
                        { label: 'Mythological', value: 'mythological', description: 'Based on real-world mythology' },
                        { label: 'Post-Apocalyptic', value: 'post_apocalyptic', description: 'Ruined fantasy world' }
                    ])
            );

        await interaction.followUp({ content: 'Now, choose your world style:', components: [worldStyleRow] });
        const worldStyleInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const worldStyle = worldStyleInteraction.values[0] as WorldStyle;

        // Tone Style Selection
        const toneStyleRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('tone_style_select')
                    .setPlaceholder('Choose adventure tone')
                    .addOptions([
                        { label: 'Heroic', value: 'heroic', description: 'Epic hero\'s journey' },
                        { label: 'Gritty', value: 'gritty', description: 'Realistic and harsh' },
                        { label: 'Humorous', value: 'humorous', description: 'Light-hearted and funny' },
                        { label: 'Mysterious', value: 'mysterious', description: 'Focus on intrigue and secrets' },
                        { label: 'Horror', value: 'horror', description: 'Scary and suspenseful' },
                        { label: 'Political', value: 'political', description: 'Focus on intrigue and power' }
                    ])
            );

        await interaction.followUp({ content: 'Now, choose your adventure tone:', components: [toneStyleRow] });
        const toneStyleInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const toneStyle = toneStyleInteraction.values[0] as ToneStyle;

        // Magic Level Selection
        const magicLevelRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('magic_level_select')
                    .setPlaceholder('Choose magic level')
                    .addOptions([
                        { label: 'High Magic', value: 'high', description: 'Magic is common and powerful' },
                        { label: 'Medium Magic', value: 'medium', description: 'Magic exists but is limited' },
                        { label: 'Low Magic', value: 'low', description: 'Magic is rare and mysterious' },
                        { label: 'No Magic', value: 'none', description: 'No magic, purely mundane world' }
                    ])
            );

        await interaction.followUp({ content: 'Now, choose the level of magic in your world:', components: [magicLevelRow] });
        const magicLevelInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const magicLevel = magicLevelInteraction.values[0] as MagicLevel;

        // Voice Type Selection
        const voiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('voice_select')
                    .setPlaceholder('Choose voice type')
                    .addOptions([
                        { label: 'None', value: 'none', description: VOICE_DESCRIPTIONS.none },
                        { label: 'Discord TTS', value: 'discord', description: VOICE_DESCRIPTIONS.discord },
                        { label: 'ElevenLabs', value: 'elevenlabs', description: VOICE_DESCRIPTIONS.elevenlabs },
                        { label: 'Kokoro', value: 'kokoro', description: VOICE_DESCRIPTIONS.kokoro }
                    ])
            );

        await interaction.followUp({ content: 'Now, choose the voice type:', components: [voiceRow] });
        const voiceInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const voiceType = voiceInteraction.values[0] as VoiceType;

        // If Kokoro is selected, offer additional voice options
        let kokoroVoice: string | undefined;
        if (voiceType === 'kokoro') {
            const voiceOptions = [...(KOKORO_VOICES_BY_LANGUAGE[language] || KOKORO_VOICES_BY_LANGUAGE['en-US'])];
            const kokoroVoiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('kokoro_voice_select')
                        .setPlaceholder('Choose Kokoro voice')
                        .addOptions(voiceOptions)
                );
            await voiceInteraction.update({
                content: 'Choose a Kokoro voice:',
                components: [kokoroVoiceRow]
            });
            const kokoroVoiceInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;
            kokoroVoice = kokoroVoiceInteraction.values[0];
            await kokoroVoiceInteraction.update({
                content: `Voice type set to: Kokoro (${kokoroVoice})\nLastly, choose the privacy setting:`,
                components: []
            });
        } else {
            await voiceInteraction.update({
                content: `Voice type set to: ${voiceType}\nLastly, choose the privacy setting:`,
                components: []
            });
        }

        // Privacy Settings (using buttons)
        const privacyRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('public')
                    .setLabel('Public')
                    .setStyle(1),
                new ButtonBuilder()
                    .setCustomId('friends_only')
                    .setLabel('Friends Only')
                    .setStyle(2),
                new ButtonBuilder()
                    .setCustomId('private')
                    .setLabel('Private')
                    .setStyle(2)
            );
        const privacyInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as ButtonInteraction;
        const privacy = privacyInteraction.customId as AdventurePrivacy;

        // -- Create Channels for the Adventure --
        await privacyInteraction.update({ content: 'Creating adventure channels...', components: [] });
        const adventureName = `adventure-${Date.now()}`;
        const category = await createCategoryChannel(interaction.guild, adventureName);
        if (!category) return await interaction.editReply('Failed to create category channel');
        const textChannel = await createTextChannel(category, 'adventure-log');
        if (!textChannel) return await interaction.editReply('Failed to create text channel');

        // Optionally, create individual player channels here...
        const playerChannels = await createPlayerChannels(category, characters);
        if (playerChannels.length === 0) return await interaction.editReply('Failed to create player channels');

        // -- Create the Adventure Record in the DB --
        const adventure = await prisma.adventure.create({
            data: {
                name: adventureName,
                status: 'ACTIVE',
                language,
                voiceType,
                privacy,
                worldStyle,
                toneStyle,
                magicLevel,
                userId: user.id,
                categoryId: category.id,
                textChannelId: textChannel.id,
                settings: {} // or custom settings if needed
            }
        });
        logger.debug('Created adventure:', { adventureId: adventure.id });

        // Additional steps: create initial scene, add adventure players, etc.
        // For example, create adventure players for each character:
        await Promise.all(characters.map(async character => {
            await prisma.adventurePlayer.create({
                data: {
                    adventureId: adventure.id,
                    characterId: character.id,
                    userId: character.user.discordId, // or character.user.id if you store that instead
                    username: character.name
                }
            });
            // Optionally set up character abilities/other details
        }));

        // Set appropriate channel permissions for all involved users...
        const allUserDiscordIds = [...characters.map(c => c.user.discordId), user.discordId];
        for (const discordId of allUserDiscordIds) {
            await category.permissionOverwrites.create(discordId, {
                ViewChannel: true,
                Connect: true,
                Stream: true,
                Speak: true
            });
            await textChannel.permissionOverwrites.create(discordId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
        }

        // Announce the adventure in the text channel
        await textChannel.send({ content: `Adventure started! Head to ${textChannel}`, components: [] });
        return await interaction.editReply(`Adventure created successfully! Check out the channels created for your adventure.`);

    } catch (error) {
        logger.error('Error starting adventure:', error);
        return await interaction.editReply('An error occurred while starting the adventure');
    }
} 