import { ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '../../prisma/client';

const prisma = new PrismaClient();

export async function handleRegister(interaction: ChatInputCommandInteraction) {
    try {
        const nickname = interaction.options.getString('nickname', true);
        
        const existingUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (existingUser) {
            await interaction.reply({
                content: `You're already registered as ${existingUser.username}!`,
                ephemeral: true
            });
            return;
        }

        const user = await prisma.user.create({
            data: {
                id: crypto.randomUUID(),
                discordId: interaction.user.id,
                username: nickname
            }
        });

        await interaction.reply({
            content: `✅ Welcome ${nickname}! You've been successfully registered.\nUse \`/link_wallet\` to connect your Solana wallet.`,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error registering user:', error);
        await interaction.reply({
            content: 'There was an error registering your account. Please try again later.',
            ephemeral: true
        });
    }
} 