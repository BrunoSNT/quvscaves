import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { translate } from '../../../shared/i18n/translations';
import { logger } from '../../../shared/logger';

export async function handleHelp(interaction: ChatInputCommandInteraction) {
    try {
        const embed = new EmbedBuilder()
            .setTitle('🎲 RPG Bot Commands')
            .setColor(0x0099FF)
            .addFields(
                {
                    name: '👤 Account',
                    value: `
\`/register\` - ${translate('commands.register')}
\`/help\` - ${translate('commands.help')}
\`/link_wallet\` - ${translate('commands.linkWallet')}`
                },
                {
                    name: '🎭 Characters',
                    value: `
\`/create_character\` - ${translate('commands.createCharacter')}
\`/list_characters\` - ${translate('commands.listCharacters')}
\`/delete_character\` - ${translate('commands.deleteCharacter')}`
                },
                {
                    name: '🗺️ Adventures',
                    value: `
\`/create_adventure\` - ${translate('commands.createAdventure')}
\`/list_adventures\` - ${translate('commands.listAdventures')}
\`/delete_adventure\` - ${translate('commands.deleteAdventure')}
\`/action\` - ${translate('commands.action')}`
                },
                {
                    name: '👥 Social',
                    value: `
\`/add_friend\` - ${translate('commands.addFriend')}
\`/remove_friend\` - ${translate('commands.removeFriend')}
\`/accept_friend\` - ${translate('commands.acceptFriend')}
\`/list_friends\` - ${translate('commands.listFriends')}`
                }
            )
            .setFooter({ text: 'Use /help <command> for detailed information about a specific command.' });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
        logger.error('Error in help command:' + formatGenericOutput(JSON.stringify(error)));
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 