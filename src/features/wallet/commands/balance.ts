import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultWalletService } from '../services/wallet';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const walletService = new DefaultWalletService();

export async function handleWalletBalance(interaction: ChatInputCommandInteraction) {
    try {
        const wallet = await walletService.getWallet(interaction.user.id);

        if (!wallet) {
            await interaction.reply({
                content: 'You don\'t have a linked wallet. Use `/link-wallet` to link one.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const balance = await walletService.getBalance(wallet.address);

        await sendFormattedResponse(interaction, {
            title: '💰 Wallet Balance',
            description: 'Here\'s your current wallet balance:',
            fields: [
                {
                    name: 'Address',
                    value: `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`,
                    inline: true
                },
                {
                    name: 'Balance',
                    value: `${balance} SOL`,
                    inline: true
                }
            ]
        });

        logger.info(`Balance checked for user ${interaction.user.id}`);
    } catch (error) {
        logger.error('Error in wallet balance command:', error);
        await interaction.reply({
            content: error.message || translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 