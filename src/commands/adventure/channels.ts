import { Guild, CategoryChannel, TextChannel, PermissionsBitField, GuildBasedChannel } from 'discord.js';
import { logger } from '../../utils/logger';
import { updateCharacterSheet } from '../../utils/character';
import { prisma } from '../../lib/prisma';

type CharacterWithUser = Awaited<ReturnType<typeof prisma.character.findFirst>> & {
    user: { discordId: string }
};

export async function createVoiceChannel(guild: Guild, name: string): Promise<CategoryChannel | null> {
    try {
        // Create category with proper permissions
        const category = await guild.channels.create({
            name,
            type: 4, // CategoryChannel = 4
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: guild.client.user!.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageRoles
                    ]
                }
            ]
        }) as CategoryChannel;

        // Create voice channel with proper permissions
        await guild.channels.create({
            name: 'Table',
            type: 2, // VoiceChannel = 2
            parent: category,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: guild.client.user!.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                }
            ]
        });

        return category;
    } catch (error) {
        logger.error('Error creating voice channel:', {
            error: error instanceof Error ? { 
                message: error.message, 
                name: error.name, 
                stack: error.stack 
            } : error,
            guildId: guild.id,
            channelName: name
        });
        return null;
    }
}

export async function createTextChannel(category: CategoryChannel, name: string): Promise<TextChannel | null> {
    try {
        return await category.guild.channels.create({
            name,
            type: 0, // TextChannel = 0
            parent: category,
            permissionOverwrites: [
                {
                    id: category.guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: category.guild.client.user!.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageRoles
                    ]
                }
            ]
        }) as TextChannel;
    } catch (error) {
        logger.error('Error creating text channel:', {
            error: error instanceof Error ? { 
                message: error.message, 
                name: error.name, 
                stack: error.stack 
            } : error,
            guildId: category.guild.id,
            categoryId: category.id,
            channelName: name
        });
        return null;
    }
}

export async function createPlayerChannels(category: CategoryChannel, characters: CharacterWithUser[]): Promise<TextChannel[]> {
    const channels: TextChannel[] = [];
    
    try {
        for (const character of characters) {
            const channel = await category.guild.channels.create({
                name: `${character.name.toLowerCase().replace(/\s+/g, '-')}`,
                type: 0, // TextChannel = 0
                parent: category,
                permissionOverwrites: [
                    {
                        id: category.guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: category.guild.client.user!.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ManageChannels,
                            PermissionsBitField.Flags.ManageRoles
                        ]
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
            
            // Initialize character sheet
            const characterWithRelations = await prisma.character.findUnique({
                where: { id: character.id },
                include: {
                    spells: true,
                    abilities: true,
                    inventory: true
                }
            });

            if (characterWithRelations) {
                await updateCharacterSheet(characterWithRelations, channel);
            }
            
            channels.push(channel);
        }
    } catch (error) {
        logger.error('Error creating player channels:', {
            error: error instanceof Error ? { 
                message: error.message, 
                name: error.name, 
                stack: error.stack 
            } : error,
            guildId: category.guild.id,
            categoryId: category.id,
            characterName: characters[0]?.name,
            adventureName: category.name
        });
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