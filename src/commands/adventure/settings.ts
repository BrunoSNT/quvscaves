import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage, VoiceType } from '../../types/game';

export async function handleAdventureSettings(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);
        const language = interaction.options.getString('language') ?? undefined;
        const voiceType = interaction.options.getString('voice') as VoiceType | undefined;

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
                }
            }
        });

        if (!adventure) {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.adventureNotFound,
                ephemeral: true
            });
            return;
        }

        const updates: Record<string, any> = {};

        if (language !== undefined) {
            updates.language = language === 'English (US)' ? 'en-US' : 'pt-BR';
        }

        if (voiceType !== undefined) {
            updates.voiceType = voiceType;
        }

        if (Object.keys(updates).length === 0) {
            await interaction.reply({
                content: 'No settings were changed.',
                ephemeral: true
            });
            return;
        }

        await prisma.adventure.update({
            where: { id: adventureId },
            data: updates
        });

        await interaction.reply({
            content: 'Adventure settings updated successfully!',
            ephemeral: true
        });

    } catch (error) {
        logger.error('Error updating adventure settings:', error);
        await interaction.reply({
            content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
            ephemeral: true
        });
    }
} 