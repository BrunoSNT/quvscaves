import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultSocialService } from '../services/social';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const socialService = new DefaultSocialService();

export async function handleAddFriend(interaction: ChatInputCommandInteraction) {
    try {
        const targetUser = interaction.options.getUser('user', true);

        // Can't add yourself as friend
        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: 'You cannot add yourself as a friend.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const friendship = await socialService.sendFriendRequest(
            interaction.user.id,
            targetUser.id
        );

        await sendFormattedResponse(interaction, {
            title: '👥 Friend Request Sent',
            description: `Friend request sent to ${targetUser.username}!`,
            fields: [
                {
                    name: 'Status',
                    value: 'Pending acceptance',
                    inline: true
                }
            ]
        });

        logger.info(`Friend request sent from ${interaction.user.id} to ${targetUser.id}`);
    } catch (error: any) {
        logger.error('Error in add friend command:', error);
        await interaction.reply({
            content: error.message || translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
}