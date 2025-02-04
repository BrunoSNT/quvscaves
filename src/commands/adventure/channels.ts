import { Guild, CategoryChannel, TextChannel, PermissionsBitField, GuildBasedChannel } from 'discord.js';
import { logger } from '../../utils/logger';

export async function createVoiceChannel(guild: Guild, name: string): Promise<CategoryChannel | null> {
    try {
        const category = await guild.channels.create({
            name,
            type: 4, // GuildCategory
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                }
            ]
        });

        // Create voice channel
        await guild.channels.create({
            name: 'Table',
            type: 2, // GuildVoice
            parent: category,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                }
            ]
        });

        return category;
    } catch (error) {
        logger.error('Error creating voice channel:', error);
        return null;
    }
}

export async function createTextChannel(category: CategoryChannel, name: string): Promise<TextChannel | null> {
    try {
        return await category.guild.channels.create({
            name,
            type: 0, // GuildText
            parent: category,
            permissionOverwrites: [
                {
                    id: category.guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                }
            ]
        }) as TextChannel;
    } catch (error) {
        logger.error('Error creating text channel:', error);
        return null;
    }
}

export async function createPlayerChannels(category: CategoryChannel, characters: { name: string; user: { discordId: string } }[]): Promise<TextChannel[]> {
    const channels: TextChannel[] = [];
    
    try {
        for (const character of characters) {
            const channel = await category.guild.channels.create({
                name: `${character.name.toLowerCase().replace(/\s+/g, '-')}`,
                type: 0, // GuildText
                parent: category,
                permissionOverwrites: [
                    {
                        id: category.guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: character.user.discordId,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    }
                ]
            }) as TextChannel;
            
            channels.push(channel);
        }
    } catch (error) {
        logger.error('Error creating player channels:', error);
    }
    
    return channels;
}

export async function deleteAdventureChannels(guild: Guild, categoryId: string): Promise<void> {
    try {
        const category = await guild.channels.fetch(categoryId);
        if (!category) return;

        // Delete all channels in the category
        if (category instanceof CategoryChannel) {
            const channels = category.children.cache;
            for (const [_, channel] of channels) {
                await channel.delete();
            }
            await category.delete();
        }
    } catch (error) {
        logger.error('Error deleting adventure channels:', error);
    }
} 