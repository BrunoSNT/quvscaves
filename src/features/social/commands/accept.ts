import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultSocialService } from '../services/social';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger, formatGenericOutput } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const socialService = new DefaultSocialService();

export async function handleAcceptFriend(interaction: ChatInputCommandInteraction) {
    try {
        const requestId = interaction.options.getString('request_id', true);

        const friendship = await socialService.acceptFriendRequest(
            requestId,
            interaction.user.id
        );

        await sendFormattedResponse(interaction, {
            title: '👥 Friend Request Accepted',
            description: 'You are now friends!',
            fields: [
                {
                    name: 'Status',
                    value: 'Accepted',
                    inline: true
                }
            ]
        });

        logger.info(`Friend request ${requestId} accepted by ${interaction.user.id}`);
    } catch (error) {
        logger.error('Error in accept friend command:' + formatGenericOutput(JSON.stringify(error)));
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 