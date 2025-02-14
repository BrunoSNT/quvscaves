import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultSocialService } from '../services/social';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const socialService = new DefaultSocialService();

export async function handleRemoveFriend(interaction: ChatInputCommandInteraction) {
    try {
        const targetUser = interaction.options.getUser('user', true);

        await socialService.removeFriend(
            interaction.user.id,
            targetUser.id
        );

        await sendFormattedResponse(interaction, {
            title: '👥 Friend Removed',
            description: `${targetUser.username} has been removed from your friend list.`
        });

        logger.info(`Friend removed: ${interaction.user.id} removed ${targetUser.id}`);
    } catch (error) {
        logger.error('Error in remove friend command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 