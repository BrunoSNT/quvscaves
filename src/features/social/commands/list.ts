import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { DefaultSocialService } from '../services/social';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const socialService = new DefaultSocialService();

export async function handleListFriends(interaction: ChatInputCommandInteraction) {
    try {
        const [friends, requests] = await Promise.all([
            socialService.listFriends(interaction.user.id),
            socialService.listFriendRequests(interaction.user.id)
        ]);

        const embeds: EmbedBuilder[] = [];

        // Friends List Embed
        if (friends.length > 0) {
            const friendsEmbed = new EmbedBuilder()
                .setTitle('👥 Your Friends')
                .setColor(0x0099FF)
                .setDescription(`You have ${friends.length} friend(s):`)
                .addFields(
                    friends.map(friend => ({
                        name: friend.user?.username || 'Unknown User',
                        value: `Characters: ${friend.user?.characters.length || 0}`,
                        inline: true
                    }))
                );
            embeds.push(friendsEmbed);
        }

        // Friend Requests Embed
        if (requests.length > 0) {
            const requestsEmbed = new EmbedBuilder()
                .setTitle('📨 Pending Friend Requests')
                .setColor(0x00FF99)
                .setDescription(`You have ${requests.length} pending friend request(s):`)
                .addFields(
                    requests.map(request => ({
                        name: request.fromUser.username,
                        value: `Characters: ${request.fromUser.characters.length}\nRequest ID: ${request.id}`,
                        inline: true
                    }))
                )
                .setFooter({ text: 'Use /accept_friend <request_id> to accept a request' });
            embeds.push(requestsEmbed);
        }

        if (embeds.length === 0) {
            await interaction.reply({
                content: 'You have no friends or pending requests yet. Use `/add_friend` to add some!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
        logger.info(`Listed friends and requests for user ${interaction.user.id}`);
    } catch (error) {
        logger.error('Error in list friends command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 