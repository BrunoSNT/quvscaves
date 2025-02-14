import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultWalletService } from '../services/wallet';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const walletService = new DefaultWalletService();

export async function handleUnlinkWallet(interaction: ChatInputCommandInteraction) {
    try {
        const wallet = await walletService.unlinkWallet(interaction.user.id);

        await sendFormattedResponse(interaction, {
            title: '💰 Wallet Unlinked',
            description: 'Your wallet has been unlinked successfully!',
            fields: [
                {
                    name: 'Address',
                    value: `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`,
                    inline: true
                }
            ]
        });

        logger.info(`Wallet unlinked for user ${interaction.user.id}`);
    } catch (error: any) {
        logger.error('Error in unlink wallet command:', error);
        await interaction.reply({
            content: error.message || translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 