import { 
    ChatInputCommandInteraction, 
    TextChannel,
    CategoryChannel,
    GuildMember,
    VoiceChannel,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ButtonInteraction,
    StringSelectMenuInteraction,
    MessageActionRowComponentBuilder
} from 'discord.js';
import { prisma } from '../../lib/prisma';
import { createVoiceChannel, createTextChannel, createPlayerChannels } from './channels';
import { logger } from '../../utils/logger';
import { 
    AdventureStatus, 
    VoiceType, 
    SupportedLanguage, 
    AdventurePrivacy,
    WorldStyle,
    ToneStyle,
    MagicLevel
} from '../../types/game';
import { getMessages } from '../../utils/language';

interface Character {
    id: string;
    name: string;
    user: {
        discordId: string;
    };
    adventures: Array<{
        adventure: {
            status: string;
        };
    }>;
}

export async function handleStartAdventure(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        logger.debug('Starting adventure creation process...');
        
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: { characters: true }
        });

        logger.debug('Found user:', { userId: user?.id, discordId: interaction.user.id });

        if (!user) {
            return await interaction.editReply('You need to register first using /register');
        }

        const playerNames = interaction.options.getString('players')?.split(',').map(name => name.trim()) || [];
        logger.debug('Player names:', playerNames);
        
        // Validate characters
        const characters = await prisma.character.findMany({
            where: {
                name: { in: playerNames },
            },
            include: {
                user: true,
                adventures: {
                    where: {
                        adventure: {
                            status: 'ACTIVE'
                        }
                    },
                    include: {
                        adventure: {
                            select: {
                                status: true
                            }
                        }
                    }
                }
            }
        }) as Character[];

        logger.debug('Found characters:', characters.map(c => ({ id: c.id, name: c.name })));

        if (characters.length !== playerNames.length) {
            const foundNames = characters.map((c: Character) => c.name);
            const missingNames = playerNames.filter(name => !foundNames.includes(name));
            return await interaction.editReply(`Some characters were not found: ${missingNames.join(', ')}`);
        }

        // Check if any character is already in an adventure
        const busyCharacters = characters.filter((c: Character) => c.adventures.some(ap => ap.adventure.status === 'ACTIVE'));
        if (busyCharacters.length > 0) {
            return await interaction.editReply(
                `The following characters are already in an adventure: ${busyCharacters.map((c: Character) => c.name).join(', ')}`
            );
        }

        if (!interaction.guild) {
            return await interaction.editReply('This command can only be used in a server');
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
                                label: 'Discord TTS',
                                value: 'discord',
                                description: 'Use Discord\'s built-in Text-to-Speech'
                            },
                            {
                                label: 'ElevenLabs',
                                value: 'elevenlabs',
                                description: 'Use ElevenLabs for more natural voices'
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

            await voiceInteraction.update({
                content: `Voice type set to: ${voiceType}\nLastly, choose the privacy setting:`,
                components: [privacyRow]
            });

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

            logger.debug('Creating channels...');
            
            const adventureName = `adventure-${Date.now()}`;
            const category = await createVoiceChannel(interaction.guild, adventureName);
            
            if (!category) {
                return await interaction.editReply('Failed to create voice channel');
            }
            logger.debug('Created category:', { categoryId: category.id });

        const textChannel = await createTextChannel(category, 'adventure-log');
        if (!textChannel) {
                return await interaction.editReply('Failed to create text channel');
            }
            logger.debug('Created text channel:', { textChannelId: textChannel.id });

            // Create player-specific channels
            const playerChannels = await createPlayerChannels(category, characters);
            if (playerChannels.length === 0) {
                return await interaction.editReply('Failed to create player channels');
            }
            logger.debug('Created player channels:', playerChannels.map(c => c.id));

            // Create adventure with all settings
        const adventure = await prisma.adventure.create({
            data: {
                    name: adventureName,
                    status: 'ACTIVE' as AdventureStatus,
                    language,
                    voiceType,
                    privacy,
                    worldStyle,
                    toneStyle,
                    magicLevel,
                userId: user.id,
                categoryId: category.id,
                    textChannelId: textChannel.id
                }
            });

            logger.debug('Created adventure:', { adventureId: adventure.id });

            // Create initial scene
            await prisma.scene.create({
                data: {
                    name: 'Beginning',
                    description: getMessages(language).defaultScenes.beginning.description,
                    adventureId: adventure.id
                }
            });

            // Create adventure players
            await Promise.all(characters.map(character => 
                prisma.adventurePlayer.create({
                    data: {
                        adventureId: adventure.id,
                        characterId: character.id
                    }
                })
            ));

            // Set up permissions
            const allUsers = [...characters.map((c: Character) => c.user.discordId), user.discordId];
            for (const userId of allUsers) {
                await category.permissionOverwrites.create(userId, {
                    ViewChannel: true,
                    Connect: true,
                    Stream: true,
                    Speak: true
                });

                await textChannel.permissionOverwrites.create(userId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
            }

            const welcomeMessage = getMessages(language).welcome.initialMessage(interaction.user.username);
            await textChannel.send(welcomeMessage);
            await textChannel.send(getMessages(language).welcome.newPlayer(characters.map((c: Character) => c.name).join(', ')));

            // Move the adventure creator to the Table voice channel
            const tableVoiceChannel = interaction.guild.channels.cache.find(
                channel => channel.name === 'Table' && 
                          channel.parentId === category.id
            ) as VoiceChannel;

            if (tableVoiceChannel && interaction.member?.voice) {
                try {
                    await (interaction.member.voice as any).setChannel(tableVoiceChannel.id);
                    logger.debug('Moved adventure creator to Table voice channel');
                } catch (error) {
                    logger.error('Failed to move user to Table voice channel:', error);
                }
            }

            return await interaction.editReply(`Adventure started! Head to ${textChannel}`);

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

    } catch (error: unknown) {
        logger.error('Error starting adventure:', error);
        if (error instanceof Error) {
            logger.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
        }
        return await interaction.editReply('An error occurred while starting the adventure');
    }
} 