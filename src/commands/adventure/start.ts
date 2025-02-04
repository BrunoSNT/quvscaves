import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { createVoiceChannel, createTextChannel, createPlayerChannels } from './channels';
import { logger } from '../../utils/logger';
import { AdventureStatus, VoiceType } from '../../types/game';

interface Character {
    id: string;
    name: string;
    user: {
        discordId: string;
    };
    adventures: Array<{
        adventure: {
            status: string;
        };
    }>;
}

export async function handleStartAdventure(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        logger.debug('Starting adventure creation process...');
        
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: { characters: true }
        });

        logger.debug('Found user:', { userId: user?.id, discordId: interaction.user.id });

        if (!user) {
            return await interaction.editReply('You need to register first using /register');
        }

        const playerNames = interaction.options.getString('players')?.split(',').map(name => name.trim()) || [];
        logger.debug('Player names:', playerNames);
        
        // Validate characters
        const characters = await prisma.character.findMany({
            where: {
                name: { in: playerNames },
            },
            include: {
                user: true,
                adventures: {
                    where: {
                        adventure: {
                            status: 'ACTIVE'
                        }
                    },
                    include: {
                        adventure: {
                            select: {
                                status: true
                            }
                        }
                    }
                }
            }
        }) as Character[];

        logger.debug('Found characters:', characters.map(c => ({ id: c.id, name: c.name })));

        if (characters.length !== playerNames.length) {
            const foundNames = characters.map((c: Character) => c.name);
            const missingNames = playerNames.filter(name => !foundNames.includes(name));
            return await interaction.editReply(`Some characters were not found: ${missingNames.join(', ')}`);
        }

        // Check if any character is already in an adventure
        const busyCharacters = characters.filter((c: Character) => c.adventures.some(ap => ap.adventure.status === 'ACTIVE'));
        if (busyCharacters.length > 0) {
            return await interaction.editReply(
                `The following characters are already in an adventure: ${busyCharacters.map((c: Character) => c.name).join(', ')}`
            );
        }

        if (!interaction.guild) {
            return await interaction.editReply('This command can only be used in a server');
        }

        logger.debug('Creating channels...');
        
        // Create channels
        const adventureName = `adventure-${Date.now()}`;
        const category = await createVoiceChannel(interaction.guild, adventureName);
        
        if (!category) {
            return await interaction.editReply('Failed to create voice channel');
        }
        logger.debug('Created category:', { categoryId: category.id });

        const textChannel = await createTextChannel(category, 'adventure-log');
        if (!textChannel) {
            return await interaction.editReply('Failed to create text channel');
        }
        logger.debug('Created text channel:', { textChannelId: textChannel.id });

        // Create player-specific channels
        const playerChannels = await createPlayerChannels(category, characters);
        if (playerChannels.length === 0) {
            return await interaction.editReply('Failed to create player channels');
        }
        logger.debug('Created player channels:', playerChannels.map(c => c.id));

        logger.debug('Creating adventure record with data:', {
            name: adventureName,
            status: 'ACTIVE',
            language: 'en-US',
            voiceType: 'discord',
            userId: user.id,
            categoryId: category.id,
            textChannelId: textChannel.id
        });

        // Create adventure with all required fields
        const adventure = await prisma.adventure.create({
            data: {
                name: adventureName,
                status: 'ACTIVE' as AdventureStatus,
                language: 'en-US',
                voiceType: 'discord' as VoiceType,
                userId: user.id,
                categoryId: category.id,
                textChannelId: textChannel.id
            }
        }).catch((error: Error) => {
            logger.error('Failed to create adventure:', error);
            throw error;
        });

        logger.debug('Created adventure:', { adventureId: adventure.id });

        logger.debug('Creating initial scene...');
        // Create initial scene
        await prisma.scene.create({
            data: {
                name: 'Beginning',
                description: 'You stand at the threshold of your adventure...',
                adventureId: adventure.id
            }
        }).catch((error: Error) => {
            logger.error('Failed to create scene:', error);
            throw error;
        });

        logger.debug('Creating adventure players...');
        // Create adventure players
        await Promise.all(characters.map(character => {
            logger.debug('Creating adventure player:', { characterId: character.id, adventureId: adventure.id });
            return prisma.adventurePlayer.create({
                data: {
                    adventureId: adventure.id,
                    characterId: character.id
                }
            }).catch((error: Error) => {
                logger.error('Failed to create adventure player:', error);
                throw error;
            });
        }));

        logger.debug('Setting up permissions...');
        // Grant permissions to all players and DM
        const allUsers = [...characters.map((c: Character) => c.user.discordId), user.discordId];
        for (const userId of allUsers) {
            await category.permissionOverwrites.create(userId, {
                ViewChannel: true,
                Connect: true,
                Stream: true,
                Speak: true
            });

            await textChannel.permissionOverwrites.create(userId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
        }

        await textChannel.send(`Adventure started! Welcome ${characters.map((c: Character) => `<@${c.user.discordId}>`).join(', ')}!`);
        logger.debug('Adventure creation completed successfully');
        
        // Move the adventure creator to the Table voice channel
        const tableVoiceChannel = interaction.guild.channels.cache.find(
            channel => channel.name === 'Table' && 
                      channel.type === ChannelType.GuildVoice &&
                      channel.parentId === category.id
        );

        if (tableVoiceChannel && interaction.member?.voice) {
            try {
                await (interaction.member.voice as any).setChannel(tableVoiceChannel.id);
                logger.debug('Moved adventure creator to Table voice channel');
            } catch (error) {
                logger.error('Failed to move user to Table voice channel:', error);
            }
        }
        
        return await interaction.editReply(`Adventure started! Head to ${textChannel}`);
    } catch (error: unknown) {
        logger.error('Error starting adventure:', error);
        if (error instanceof Error) {
            logger.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
        }
        return await interaction.editReply('An error occurred while starting the adventure');
    }
} 