import { SlashCommandBuilder } from 'discord.js';
import { handleLinkWallet } from './link';
import { handleUnlinkWallet } from './unlink';
import { handleWalletBalance } from './balance';

export const walletCommands = [
    {
        data: new SlashCommandBuilder()
            .setName('link-wallet')
            .setDescription('Link your Solana wallet')
            .addStringOption(option =>
                option
                    .setName('address')
                    .setDescription('Your Solana wallet address')
                    .setRequired(true)
            ),
        execute: handleLinkWallet
    },
    {
        data: new SlashCommandBuilder()
            .setName('unlink-wallet')
            .setDescription('Unlink your Solana wallet'),
        execute: handleUnlinkWallet
    },
    {
        data: new SlashCommandBuilder()
            .setName('wallet-balance')
            .setDescription('Check your wallet balance'),
        execute: handleWalletBalance
    }
];

export { handleLinkWallet, handleUnlinkWallet, handleWalletBalance }; 