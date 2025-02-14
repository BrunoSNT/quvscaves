import { ChatInputCommandInteraction } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const adventureService = new AdventureService();

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        const adventure = await adventureService.joinAdventure(
            adventureId,
            interaction.user.id,
            characterName
        );

        await sendFormattedResponse(interaction, {
            title: '🎲 Joined Adventure!',
            description: `You have joined "${adventure.name}" with your character ${characterName}.`,
            fields: [
                {
                    name: 'Players',
                    value: adventure.players.map(p => p.character!.name).join(', '),
                    inline: true
                }
            ]
        });

        logger.info(`User ${interaction.user.id} joined adventure ${adventureId}`);
    } catch (error) {
        logger.error('Error in join adventure command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 