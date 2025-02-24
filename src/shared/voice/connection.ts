import { VoiceChannel, VoiceConnection, VoiceConnectionStatus, joinVoiceChannel } from '@discordjs/voice';
import { entersState } from '@discordjs/voice';
import { logger, formatGenericOutput } from '../logger';

export const voiceConnectionPool = new Map<string, {
    connection: VoiceConnection;
    lastUsed: number;
    disconnectTimeout?: NodeJS.Timeout;
}>();

export async function getOrCreateVoiceConnection(channel: VoiceChannel): Promise<VoiceConnection> {
    const guildId = channel.guild.id;
    const existingData = voiceConnectionPool.get(guildId);

    if (existingData) {
        // Clear any pending disconnect
        if (existingData.disconnectTimeout) {
            clearTimeout(existingData.disconnectTimeout);
            existingData.disconnectTimeout = undefined;
        }
        existingData.lastUsed = Date.now();
        
        // Check if connection is still valid
        if (existingData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            return existingData.connection;
        }
        voiceConnectionPool.delete(guildId);
    }

    // Create new connection
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Store in pool
    voiceConnectionPool.set(guildId, {
        connection,
        lastUsed: Date.now()
    });

    return connection;
}

// Clean up old connections periodically
setInterval(() => {
    const now = Date.now();
    for (const [guildId, data] of voiceConnectionPool.entries()) {
        if (now - data.lastUsed > 5 * 60 * 1000) { // 5 minutes
            if (data.disconnectTimeout) {
                clearTimeout(data.disconnectTimeout);
            }
            data.connection.destroy();
            voiceConnectionPool.delete(guildId);
        }
    }
}, 60 * 1000); // Check every minute

export function safeDestroyConnection(connection: VoiceConnection, guildId: string) {
    try {
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
        voiceConnectionPool.delete(guildId);
    } catch (error) {
        logger.error('Error safely destroying connection:' + formatGenericOutput(JSON.stringify(error)));
    }
} 