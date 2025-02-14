import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const adventureService = new AdventureService();

export async function handleAdventureSettings(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);
        const adventure = await adventureService.getAdventure(adventureId);

        if (!adventure) {
            await interaction.reply({
                content: 'Adventure not found.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // For now, just show adventure settings
        // TODO: Implement adventure settings modification
        await sendFormattedResponse(interaction, {
            title: '⚙️ Adventure Settings',
            description: `Settings for "${adventure.name}":`,
            fields: [
                {
                    name: 'World Style',
                    value: adventure.settings.worldStyle,
                    inline: true
                },
                {
                    name: 'Tone',
                    value: adventure.settings.toneStyle,
                    inline: true
                },
                {
                    name: 'Magic Level',
                    value: adventure.settings.magicLevel,
                    inline: true
                },
                {
                    name: 'Language',
                    value: adventure.settings.language,
                    inline: true
                },
                {
                    name: 'Voice Enabled',
                    value: adventure.settings.useVoice ? 'Yes' : 'No',
                    inline: true
                }
            ]
        });

        logger.info(`Displayed settings for adventure ${adventureId}`);
    } catch (error) {
        logger.error('Error in adventure settings command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 