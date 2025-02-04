import { 
    ChatInputCommandInteraction, 
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonInteraction,
    StringSelectMenuInteraction,
    MessageActionRowComponentBuilder
} from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { 
    SupportedLanguage, 
    VoiceType, 
    WorldStyle,
    ToneStyle,
    MagicLevel,
    AdventurePrivacy
} from '../../types/game';

export async function handleAdventureSettings(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const adventureId = interaction.options.getString('adventure_id', true);

        // First find the user's active adventures through AdventurePlayer
        const adventure = await prisma.adventure.findFirst({
            where: {
                id: adventureId,
                players: {
                    some: {
                        character: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                }
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.adventureNotFound,
            });
            return;
        }

        // Create settings menu
        const settingsRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_select')
                    .setPlaceholder('Choose setting to modify')
                    .addOptions([
                        {
                            label: 'Language',
                            value: 'language',
                            description: 'Change adventure language'
                        },
                        {
                            label: 'Voice Type',
                            value: 'voice',
                            description: 'Change voice generation type'
                        },
                        {
                            label: 'World Style',
                            value: 'world_style',
                            description: 'Change world style'
                        },
                        {
                            label: 'Adventure Tone',
                            value: 'tone_style',
                            description: 'Change adventure tone'
                        },
                        {
                            label: 'Magic Level',
                            value: 'magic_level',
                            description: 'Change magic level'
                        },
                        {
                            label: 'Privacy',
                            value: 'privacy',
                            description: 'Change privacy settings'
                        }
                    ])
            );

        const setupMsg = await interaction.editReply({
            content: 'Adventure Settings\nCurrent settings:\n' +
                    `- Language: ${adventure.language === 'en-US' ? 'English (US)' : 'Português (Brasil)'}\n` +
                    `- Voice Type: ${adventure.voiceType === 'discord' ? 'Discord TTS' : 'ElevenLabs'}\n` +
                    `- World Style: ${adventure.worldStyle.replace(/_/g, ' ')}\n` +
                    `- Adventure Tone: ${adventure.toneStyle}\n` +
                    `- Magic Level: ${adventure.magicLevel}\n` +
                    `- Privacy: ${adventure.privacy}\n\n` +
                    'Select a setting to modify:',
            components: [settingsRow]
        });

        try {
            const settingInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            }) as StringSelectMenuInteraction;

            let updateRow;
            switch (settingInteraction.values[0]) {
                case 'language':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;

                case 'voice':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;

                case 'world_style':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;

                case 'tone_style':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;

                case 'magic_level':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;

                case 'privacy':
                    updateRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
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
                    break;
            }

            await settingInteraction.update({
                content: `Choose new value for ${settingInteraction.values[0].replace(/_/g, ' ')}:`,
                components: [updateRow]
            });

            const valueInteraction = await setupMsg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            const updates: Record<string, any> = {};
            const settingType = settingInteraction.values[0];
            const newValue = settingType === 'privacy' ? 
                (valueInteraction as ButtonInteraction).customId : 
                (valueInteraction as StringSelectMenuInteraction).values[0];

            updates[settingType === 'voice' ? 'voiceType' : settingType] = newValue;

            await prisma.adventure.update({
                where: { id: adventureId },
                data: updates
            });

            await valueInteraction.update({
                content: `Successfully updated ${settingType.replace(/_/g, ' ')} to: ${newValue}`,
                components: []
            });

        } catch (error) {
            if (error instanceof Error && error.name === 'Error [InteractionCollectorError]') {
                await interaction.editReply({
                    content: 'Settings update timed out. Please try again.',
                    components: []
                });
            } else {
                throw error;
            }
        }

    } catch (error) {
        logger.error('Error updating adventure settings:', error);
        await interaction.editReply({
            content: getMessages(interaction.locale as SupportedLanguage).errors.genericError
        });
    }
} 