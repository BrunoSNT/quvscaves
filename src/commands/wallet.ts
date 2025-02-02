import { ChatInputCommandInteraction } from 'discord.js';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/prisma';
import QRCode from 'qrcode';

export async function handleLinkWallet(interaction: ChatInputCommandInteraction) {
    try {
        const walletAddress = interaction.options.getString('address', true);

        // Validate Solana wallet address
        try {
            new PublicKey(walletAddress);
        } catch (error) {
            await interaction.reply({
                content: '❌ Invalid Solana wallet address. Please check and try again.',
                ephemeral: true
            });
            return;
        }

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.reply({
                content: 'Please register first using `/register`',
                ephemeral: true
            });
            return;
        }

        // Generate QR code
        const qrCodeDataUrl = await QRCode.toDataURL(`solana:${walletAddress}`);

        // Update user's wallet
        await prisma.user.update({
            where: { id: user.id },
            data: { walletAddress }
        });

        await interaction.reply({
            content: `✅ Wallet linked successfully!\n\nWallet Address: \`${walletAddress}\`\n\nScan this QR code with your Solana wallet app:`,
            files: [{
                attachment: Buffer.from(qrCodeDataUrl.split(',')[1], 'base64'),
                name: 'wallet-qr.png'
            }],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error linking wallet:', error);
        await interaction.reply({
            content: 'Failed to link wallet. Please try again.',
            ephemeral: true
        });
    }
} 