import { ChatInputCommandInteraction } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { logger } from '../../utils/logger';

export async function handleDisconnectVoice(interaction: ChatInputCommandInteraction) {
    try {
        const connection = getVoiceConnection(interaction.guildId!);
        if (connection) {
            connection.destroy();
            await interaction.reply({ content: 'Disconnected from voice channel.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'Not connected to any voice channel.', ephemeral: true });
        }
    } catch (error) {
        logger.error('Error disconnecting from voice:', error);
        await interaction.reply({ content: 'Failed to disconnect from voice channel.', ephemeral: true });
    }
} 