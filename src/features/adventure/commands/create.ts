import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonInteraction,
    StringSelectMenuInteraction,
    MessageActionRowComponentBuilder,
    ChannelType,
    GuildMember,
    User,
    ChatInputCommandInteraction,
    MessageFlags,
    Message,
    TextChannel,
    ButtonStyle,
    CategoryChannel,
    VoiceChannel
} from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { logger, prettyPrintLog } from '../../../shared/logger';
import { VoiceType, WorldStyle, ToneStyle, MagicLevel, AdventurePrivacy, RollMode } from '../../../shared/game/types';
import { prisma } from '../../../core/prisma';
import { createCategoryChannel, createTextChannel, createPlayerChannels } from '../../../shared/discord/channels';
import { KOKORO_VOICES_BY_LANGUAGE, VOICE_DESCRIPTIONS } from '../../../features/voice/config/voice';
import { SupportedLanguage } from '../../../shared/i18n/types';
import { getMessages } from '../../../shared/i18n/translations';
import { Character } from '../../../../prisma/client';
import { AdventureService } from '../services/adventure';
import { GameMaster } from '../../../ai/gamemaster';
import { Adventure } from '../types';
import { ActionType } from '../../../shared/game/types';
import { v4 as uuidv4 } from 'uuid';
import { GameStats, GameSkills } from '../../../shared/game/types';
import { VoiceConfig, VoiceProvider } from '../../../features/voice/types';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
import { Readable } from 'stream';
import { getVoiceService } from '../../../features/voice/services';
import { VectorStore } from '../../../core/vector/store';
import { ACTION_CONCEPTS } from './action';

const adventureService = new AdventureService();

function isValidLanguage(lang: string | null): lang is SupportedLanguage {
    return lang === 'en-US' || lang === 'pt-BR';
}

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
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
                                description: 'Historical medieval setting'
                            },
                            {
                                label: 'Wizarding World',
                                value: 'wizarding_world',
                                description: 'Harry Potter-style magical world with schools, wands, and magical creatures'
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
            if (voiceType === 'KOKORO') {
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
                    flags: MessageFlags.Ephemeral
                });
            }
            // Create the adventure with all settings
            const adventure = await prisma.adventure.create({
                data: {
                    name: adventureName,
                    status: 'ACTIVE',
                    language,
                    voiceType: 'KOKORO',
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
                    await i.deferReply({ flags: MessageFlags.Ephemeral });

                    if (!i.guild) {
                        logger.error('Guild not found');
                        return;
                    }

                    // Ensure language is valid
                    if (!language) {
                        logger.error('Language is null');
                        return;
                    }

                    if (!isValidLanguage(language)) {
                        logger.error('Invalid language');
                        return;
                    }

                    const category = i.guild.channels.cache.get(adventure.categoryId!) as CategoryChannel | undefined;
                    if (!category) {
                        logger.error('Category not found');
                        return;
                    }

                    const voiceChannel = category.children.cache.find(
                        (channel): channel is VoiceChannel => 
                            channel.name.toLowerCase() === 'table' && 
                            channel.type === ChannelType.GuildVoice
                    );

                    if (!voiceChannel) {
                        logger.error('Voice channel not found');
                        return;
                    }

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

                    // Create a new GameMaster instance
                    const gameMaster = new GameMaster(adventure.id);
                    
                    // Build initial context and override what we need
                    const context = await adventureService.buildGameContext(adventure as unknown as Adventure, '');
                    const worldPrompt = generateInitialWorldPrompt(worldStyle, toneStyle, magicLevel, language);
                    const response = await gameMaster.generateResponse({
                        ...context,
                        playerActions: [language === 'pt-BR' 
                            ? 'Descrição vívida e detalhada do mundo incorporando todos os elementos necessários.'
                            : 'Vivid and detailed world description incorporating all required elements.'],
                        memory: {
                            recentScenes: [],
                            activeQuests: [],
                            knownCharacters: [],
                            discoveredLocations: [],
                            importantItems: []
                        }
                    }, worldPrompt);
                    
                    if (!response) {
                        throw new Error('Failed to generate world introduction');
                    }

                    const parsedResponse = JSON.parse(response);
                    
                    // Configure voice service
                    const voiceConfig: VoiceConfig = {
                        provider: adventure.voiceType as VoiceProvider,
                        language,
                        speed: 1.0
                    };

                    if (adventure.voiceType === 'ELEVENLABS' && process.env.ELEVENLABS_API_KEY) {
                        voiceConfig.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
                    }

                    // Get texts to narrate
                    const textsToNarrate = [
                        language === 'en-US' ? parsedResponse.world_context : parsedResponse.contexto_mundo,
                        language === 'en-US' ? parsedResponse.narration : parsedResponse.narracao,
                        language === 'en-US' ? parsedResponse.atmosphere : parsedResponse.atmosfera
                    ].filter((text): text is string => typeof text === 'string' && text.length > 0);

                    // Start playing narration and get the promises
                    const { startedPlaying, finished } = await playNarration(voiceChannel, textsToNarrate, voiceConfig);

                    // Send the first embed with world context as soon as voice starts playing
                    startedPlaying.then(async () => {
                        try {
                            // First message with world context
                            const worldContextEmbed = new EmbedBuilder()
                                .setTitle(language === 'pt-BR' ? '🌟 Bem-vindo à sua Aventura!' : '🌟 Welcome to Your Adventure!')
                                .setDescription(language === 'en-US' 
                                    ? parsedResponse.world_context
                                    : parsedResponse.contexto_mundo)
                                .setColor(0x7289da);

                            await textChannel.send({ embeds: [worldContextEmbed] });

                            // Second message with narration, atmosphere, and actions
                            const actionButtons = await createActionButtons(
                                (language === 'en-US' ? parsedResponse.available_actions : parsedResponse.acoes_disponiveis)
                                    .map((text: string) => ({ type: ActionType.NARRATIVE, text }))
                            );

                            const narrativeEmbed = new EmbedBuilder()
                                .setDescription(language === 'en-US'
                                    ? `${parsedResponse.narration}\n\n${parsedResponse.atmosphere ? `## 🌅 Atmosphere\n${parsedResponse.atmosphere}\n\n` : ''}## ⚔️ Available Actions:\n${parsedResponse.available_actions.map((action: string) => `• ${action}`).join('\n')}`
                                    : `${parsedResponse.narracao}\n\n${parsedResponse.atmosfera ? `## 🌅 Atmosfera\n${parsedResponse.atmosfera}\n\n` : ''}## ⚔️ Ações Disponíveis:\n${parsedResponse.acoes_disponiveis.map((action: string) => `• ${action}`).join('\n')}`)
                                .setColor(0x7289da)
                                .setFooter({
                                    text: language === 'pt-BR' 
                                        ? `💭 *Use /action para ações personalizadas*`
                                        : `💭 *Use /action for custom actions*`
                                });

                            await textChannel.send({
                                embeds: [narrativeEmbed],
                                components: [{
                                    type: 1,
                                    components: actionButtons
                                }]
                            });
                        } catch (error) {
                            logger.error('Error sending messages:', error);
                        }
                    }).catch(error => {
                        logger.error('Error in startedPlaying promise:', error);
                    });

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

                    // Wait for narration to finish
                    await finished;

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
                                flags: MessageFlags.Ephemeral
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
        logger.error('Error creating adventure:\n' + prettyPrintLog(JSON.stringify({
            userId: interaction.user.id,
            error: error instanceof Error ? {
                message: error.message,
                stack: error.stack
            } : error
        })) + "\n\n");

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
            logger.error('Failed to send error response:\n' + responseError);
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
        logger.debug('Player names:\n' + playerNames);

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
                    include: { adventure: { select: { status: true } }}
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
                        { label: 'Medieval', value: 'medieval', description: 'Historical medieval setting' },
                        { label: 'Wizarding World', value: 'wizarding_world', description: 'Harry Potter-style magical world with schools, wands, and magical creatures' }
                    ])
            );

        await interaction.followUp({ content: 'Now, choose your world style:\n' + prettyPrintLog(JSON.stringify({ components: [worldStyleRow] }))});
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

        await interaction.followUp({ content: 'Now, choose your adventure tone:\n' + prettyPrintLog(JSON.stringify({ components: [toneStyleRow] }))});
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

        await interaction.followUp({ content: 'Now, choose the level of magic in your world:\n' + prettyPrintLog(JSON.stringify({ components: [magicLevelRow] }))});
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

        await interaction.followUp({ content: 'Now, choose the voice type:\n' + prettyPrintLog(JSON.stringify({ components: [voiceRow] }))});
        const voiceInteraction = await setupMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 300000
        }) as StringSelectMenuInteraction;
        const voiceType = voiceInteraction.values[0] as VoiceType;

        // If Kokoro is selected, offer additional voice options
        let kokoroVoice: string | undefined;
        if (voiceType === 'KOKORO') {
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
                voiceType: 'KOKORO',
                privacy,
                worldStyle,
                toneStyle,
                magicLevel,
                userId: user.id,
                categoryId: category.id,
                textChannelId: textChannel.id,
                settings: {
                    kokoroVoice
                },
                players: {
                    create: characters.map(char => ({
                        userId: char.userId,
                        characterId: char.id,
                        username: char.name
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
        logger.debug('Created adventure:\n' + prettyPrintLog(JSON.stringify({ adventureId: adventure.id })) + "\n\n");

        // Create initial scene memory
        const messages = getMessages(language);
        const initialScene = messages.defaultScenes.beginning;
        await prisma.memory.create({
            data: {
                adventureId: adventure.id,
                type: 'SCENE',
                title: initialScene.name,
                description: initialScene.description,
                metadata: {
                    location: initialScene.location,
                    summary: initialScene.summary
                }
            }
        });

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
        logger.error('Error starting adventure:\n' + error);
        return await interaction.editReply('An error occurred while starting the adventure');
    }
}

function generateInitialWorldPrompt(worldStyle: WorldStyle, toneStyle: ToneStyle, magicLevel: MagicLevel, language: SupportedLanguage): string {
    const basePrompt = `You are a Game Master creating a rich and immersive world for a new adventure. Your task is to create a detailed initial world description that will serve as the foundation for the player's journey.

WORLD PARAMETERS:
- World Style: ${worldStyle}
- Tone Style: ${toneStyle}
- Magic Level: ${magicLevel}
- Language: ${language}

REQUIRED ELEMENTS:
1. World Context (500 words):
   - Brief overview of the world's history
   - Current state of civilization
   - Major powers and conflicts

2. Narration (300 words):
   - Vivid description of the immediate surroundings
   - Notable landmarks and features
   - Current events and situations

3. Atmosphere (100 words):
   - Current weather and time of day
   - Mood and emotional tone
   - Sensory details (sounds, smells, etc.)
   - Environmental ambiance

4. Available Actions:
   - 5 specific actions players can take
   - Mix of exploration, interaction, and investigation
   - Each action should lead to potential adventure hooks

RESPONSE FORMAT:
You MUST respond with a valid JSON object that matches this exact structure:

${language === 'en-US' ? `{
    "world_context": "Detailed overview of the world's history and current state",
    "narration": "Vivid description of the immediate surroundings and situation in a broad world context so we can understand the initial narrative",
    "atmosphere": "Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 that explores the immediate surroundings",
        "Action 2 that interacts with local inhabitants",
        "Action 3 that investigates a point of interest",
        "Action 4 that seeks more information about the world",
        "Action 5 that begins a potential quest or mission"
    ]
}` : `{
    "contexto_mundo": "Visão detalhada da história e estado atual do mundo",
    "narracao": "Descrição vívida dos arredores imediatos e da situação em um contexto de mundo amplo para que possamos entender a narrativa inicial",
    "atmosfera": "Humor atual, clima e detalhes ambientais",
    "acoes_disponiveis": [
        "Ação 1 que explora os arredores imediatos",
        "Ação 2 que interage com habitantes locais",
        "Ação 3 que investiga um ponto de interesse",
        "Ação 4 que busca mais informações sobre o mundo",
        "Ação 5 que inicia uma possível missão ou quest"
    ]
}`}`;

    return basePrompt;
}

async function createActionButtons(actions: Array<{ type: ActionType; text: string }>): Promise<ButtonBuilder[]> {
    const vectorStore = VectorStore.getInstance();
    
    return Promise.all(actions.map(async action => {
        let style = ButtonStyle.Primary; // Default blue
        
        if (action.type === ActionType.QUESTION) {
            style = ButtonStyle.Secondary;
        } else if (action.type === ActionType.COMBAT) {
            style = ButtonStyle.Danger;
        }

        // Get emoji for the action using the same system as action.ts
        let highestSimilarity = -1;
        let bestCategory = "default";

        // Get concepts for the current language
        const languageConcepts = ACTION_CONCEPTS['en-US'];

        // Compare action text with each category's concepts
        for (const [category, data] of Object.entries(languageConcepts)) {
            const { similarity } = await vectorStore.compareWithConcepts(action.text, (data as { concepts: string[] }).concepts);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestCategory = category;
            }
        }

        // Only use the category if similarity is above threshold
        const emoji = highestSimilarity > 0.3 
            ? (languageConcepts[bestCategory as keyof typeof languageConcepts] as { emoji: string }).emoji 
            : "➡️";

        const buttonId = `action_${action.type}_${uuidv4()}`;
        
        // Properly truncate text to 80 characters with ellipsis if needed
        const truncatedText = action.text.length > 80 
            ? action.text.substring(0, 77) + '...'
            : action.text;

        return new ButtonBuilder()
            .setCustomId(buttonId)
            .setLabel(truncatedText)
            .setStyle(style)
            .setEmoji(emoji);
    }));
}

// Update the playNarration function
async function playNarration(channel: VoiceChannel, texts: string[], config: VoiceConfig): Promise<{ startedPlaying: Promise<void>; finished: Promise<void> }> {
    try {
        logger.info('Starting voice narration...');
        logger.info(`Received ${texts.length} texts to narrate`);

        // Validate texts
        if (texts.length === 0) {
            logger.warn('No texts to narrate');
            return {
                startedPlaying: Promise.resolve(),
                finished: Promise.resolve()
            };
        }

        // Log the texts for debugging
        texts.forEach((text, index) => {
            logger.info(`Text ${index + 1}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
        });
        
        logger.info('Attempting to join voice channel...');
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        // Add connection state logging
        connection.on(VoiceConnectionStatus.Ready, () => {
            logger.info('Voice connection is ready');
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            logger.warn('Voice connection disconnected');
        });

        connection.on('error', (error) => {
            logger.error('Voice connection error:', error);
        });

        logger.info('Creating audio player...');
        const player = createAudioPlayer();
        
        // Add player state logging
        player.on('error', error => {
            logger.error('Audio player error:', error);
        });

        player.on(AudioPlayerStatus.Playing, () => {
            logger.info('Audio player is playing');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            logger.info('Audio player is idle');
        });

        logger.info('Subscribing connection to player...');
        connection.subscribe(player);

        // Create promises for tracking playback
        let startedPlayingResolve!: (value: void | PromiseLike<void>) => void;
        let finishedResolve!: (value: void | PromiseLike<void>) => void;
        const startedPlaying = new Promise<void>((resolve) => {
            startedPlayingResolve = resolve;
        });
        const finished = new Promise<void>((resolve) => {
            finishedResolve = resolve;
        });

        // Get voice service
        logger.info('Getting voice service...');
        const voiceService = await getVoiceService(config.provider);
        logger.info(`Using voice service: ${config.provider}`);
        
        // Split texts into sentences
        const splitIntoSentences = (text: string): string[] => {
            return text.split(/(?<=[.!?])\s+|\s*$/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        };

        // Process each text into sentences and group them into chunks
        logger.info('Processing texts into chunks...');
        const processedTexts = texts.map((text, index) => {
            if (!text || text.trim().length === 0) {
                logger.warn(`Text ${index + 1} is empty, skipping...`);
                return [];
            }

            logger.info(`Processing text ${index + 1}/${texts.length}, length: ${text.length} chars`);
            const sentences = splitIntoSentences(text);
            const chunks: string[] = [];
            let currentChunk = '';

            for (const sentence of sentences) {
                if ((currentChunk + sentence).length > 500) {
                    if (currentChunk) {
                        chunks.push(currentChunk.trim());
                    }
                    currentChunk = sentence;
                } else {
                    currentChunk += (currentChunk ? ' ' : '') + sentence;
                }
            }
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            logger.info(`Text ${index + 1} split into ${chunks.length} chunks`);
            return chunks;
        });

        // Flatten the array of chunks
        const allChunks = processedTexts.flat();
        logger.info(`Total chunks to process: ${allChunks.length}`);

        if (allChunks.length === 0) {
            logger.warn('No valid chunks to narrate');
            return {
                startedPlaying: Promise.resolve(),
                finished: Promise.resolve()
            };
        }

        // Generate first two segments in parallel
        logger.info('Generating first two segments...');
        const firstTwoSegments = await Promise.all(
            allChunks.slice(0, 2).map(async (chunk, index) => {
                logger.info(`Generating audio for chunk ${index + 1}/2: ${chunk.substring(0, 50)}...`);
                const buffer = await voiceService.speak(chunk, config);
                logger.info(`Generated audio buffer for chunk ${index + 1}, size: ${buffer?.length || 0} bytes`);
                return buffer;
            })
        );
        logger.info('First two segments generated');

        // Start playing first two segments
        let isFirstBuffer = true;
        for (const audioBuffer of firstTwoSegments) {
            if (!audioBuffer || audioBuffer.length === 0) {
                logger.warn('Received empty audio buffer, skipping...');
                continue;
            }

            logger.info(`Creating readable stream for audio buffer of size: ${audioBuffer.length} bytes`);
            const stream = Readable.from(audioBuffer);
            logger.info('Creating audio resource from stream...');
            const resource = createAudioResource(stream);
            
            logger.info('Playing audio resource...');
            player.play(resource);

            // Resolve startedPlaying promise when the first buffer starts playing
            if (isFirstBuffer) {
                player.once(AudioPlayerStatus.Playing, () => {
                    logger.info('First audio segment started playing');
                    startedPlayingResolve();
                });
                isFirstBuffer = false;
            }

            // Wait for the audio to finish playing
            await new Promise<void>((resolve) => {
                player.once(AudioPlayerStatus.Idle, () => {
                    logger.info('Audio segment finished playing');
                    resolve();
                });
            });
        }

        // Generate and play remaining segments
        if (allChunks.length > 2) {
            logger.info(`Generating remaining ${allChunks.length - 2} segments...`);
            const remainingSegments = await Promise.all(
                allChunks.slice(2).map(async (chunk, index) => {
                    logger.info(`Generating audio for remaining chunk ${index + 1}/${allChunks.length - 2}`);
                    return voiceService.speak(chunk, config);
                })
            );

            for (const audioBuffer of remainingSegments) {
                if (!audioBuffer || audioBuffer.length === 0) {
                    logger.warn('Received empty audio buffer, skipping...');
                    continue;
                }

                logger.info(`Playing remaining audio buffer of size: ${audioBuffer.length} bytes`);
                const stream = Readable.from(audioBuffer);
                const resource = createAudioResource(stream);
                
                player.play(resource);

                // Wait for the audio to finish playing
                await new Promise<void>((resolve) => {
                    player.once(AudioPlayerStatus.Idle, () => {
                        logger.info('Audio segment finished playing');
                        resolve();
                    });
                });
            }
        }

        // Cleanup
        logger.info('Audio playback completed, cleaning up...');
        connection.destroy();
        finishedResolve();

        return { startedPlaying, finished };
    } catch (error) {
        logger.error('Error in playNarration:', error);
        throw error;
    }
} 