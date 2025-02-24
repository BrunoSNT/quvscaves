import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultWalletService } from '../services/wallet';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { formatGenericOutput } from '../../../shared/logger';

const walletService = new DefaultWalletService();

export async function handleLinkWallet(interaction: ChatInputCommandInteraction) {
    try {
        const address = interaction.options.getString('address', true);

        const wallet = await walletService.linkWallet(
            interaction.user.id,
            address
        );

        await sendFormattedResponse(interaction, {
            title: '💰 Wallet Linked',
            description: 'Your wallet has been linked successfully!',
            fields: [
                {
                    name: 'Address',
                    value: `${address.slice(0, 6)}...${address.slice(-4)}`,
                    inline: true
                },
                {
                    name: 'Balance',
                    value: `${wallet.balance} SOL`,
                    inline: true
                }
            ]
        });

        logger.info(`Wallet linked for user ${interaction.user.id}`);
    } catch (error: any) {
        logger.error('Error in link wallet command:' + formatGenericOutput(JSON.stringify(error)));
        await interaction.reply({
            content: error.message || translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 