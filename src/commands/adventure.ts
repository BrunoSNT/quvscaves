import { ChatInputCommandInteraction, ChannelType, CategoryChannel } from 'discord.js';
import { prisma } from '../lib/prisma';
import { generateResponse } from '../ai/gamemaster';

export async function handleStartAdventure(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get selected characters from the command options
        const selectedCharacterNames = interaction.options.getString('players', true).split(',');

        // Get user's friends
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                friends: {
                    where: { status: 'ACCEPTED' },
                    include: { friend: true }
                }
            }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first.'
            });
            return;
        }

        // Get friend IDs including the user's own ID
        const allowedUserIds = [user.id, ...user.friends.map(f => f.friend.id)];

        // Find characters by name belonging to friends
        const characters = await prisma.character.findMany({
            where: {
                name: { in: selectedCharacterNames },
                userId: { in: allowedUserIds }
            },
            include: {
                user: true
            }
        });

        if (characters.length === 0) {
            await interaction.editReply({
                content: 'No valid characters selected.'
            });
            return;
        }

        // Create the adventure
        const adventure = await prisma.adventure.create({
            data: {
                name: `${characters[0].name}'s Quest`,
                status: 'ACTIVE',
                userId: user.id,
                players: {
                    create: characters.map(char => ({
                        characterId: char.id
                    }))
                }
            }
        });

        // Create category and channels
        const referenceCategory = interaction.guild?.channels.cache.get('1335320205055885354') as CategoryChannel;
        
        const adventureCategory = await interaction.guild?.channels.create({
            name: `🎲 ${adventure.name}`,
            type: ChannelType.GuildCategory,
            position: referenceCategory.position + 1
        });

        // Create standard channels
        const textChannel = await interaction.guild?.channels.create({
            name: `adventure-log`,
            type: ChannelType.GuildText,
            parent: adventureCategory?.id
        });

        const diceChannel = await interaction.guild?.channels.create({
            name: `dice`,
            type: ChannelType.GuildText,
            parent: adventureCategory?.id
        });

        // Create player-specific channels
        for (const character of characters) {
            await interaction.guild?.channels.create({
                name: character.name.toLowerCase().replace(/\s+/g, '-'),
                type: ChannelType.GuildText,
                parent: adventureCategory?.id,
                permissionOverwrites: [
                    {
                        id: character.user.discordId,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.user.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel']
                    }
                ]
            });
        }

        const voiceChannel = await interaction.guild?.channels.create({
            name: `Table`,
            type: ChannelType.GuildVoice,
            parent: adventureCategory?.id
        });

        // Update adventure with channel IDs
        await prisma.adventure.update({
            where: { id: adventure.id },
            data: {
                textChannelId: textChannel?.id,
                voiceChannelId: voiceChannel?.id,
                categoryId: adventureCategory?.id
            }
        });

        // Create initial scene
        const initialScene = await prisma.scene.create({
            data: {
                name: 'Beginning',
                description: 'You stand at the threshold of your adventure...',
                adventureId: adventure.id
            }
        });

        try {
            // Generate initial narrative using AI
            const context = {
                scene: initialScene.description,
                playerActions: [],
                characters: characters,
                currentState: {
                    health: 100,
                    mana: 100,
                    inventory: [],
                    questProgress: 'STARTING'
                }
            };

            const response = await generateResponse(context);
            await textChannel?.send({
                content: `Welcome, ${interaction.user.username}!\n\n${response}`
            });
        } catch (aiError) {
            console.error('AI Error:', aiError);
            await textChannel?.send({
                content: `Welcome, ${interaction.user.username}!\n\n[Narration] You stand at the beginning of your journey, ready for adventure.\n[Dialogue] "Welcome, brave adventurer! What would you like to do?"\n[Choices] - Explore the area\n- Talk to nearby NPCs\n- Check your equipment`
            });
        }

        await interaction.editReply({
            content: `✨ Adventure started! Your adventure channels have been created!`
        });

    } catch (error) {
        console.error('Error starting adventure:', error);
        await interaction.editReply({
            content: 'Failed to start adventure. Please try again.'
        }).catch(console.error);
    }
}

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        // Get user and their character
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                characters: true
            }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first using `/register`'
            });
            return;
        }

        // Find the character
        const character = user.characters.find(c => c.name === characterName);
        if (!character) {
            await interaction.editReply({
                content: 'Character not found. Please create a character first using `/create_character`'
            });
            return;
        }

        // Find the adventure
        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId },
            include: {
                players: {
                    include: {
                        character: true
                    }
                },
                user: true
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: 'Adventure not found.'
            });
            return;
        }

        // Check if already in the adventure
        const alreadyJoined = adventure.players.some(p => p.character.userId === user.id);
        if (alreadyJoined) {
            await interaction.editReply({
                content: 'You are already in this adventure.'
            });
            return;
        }

        // Check if adventure owner is a friend
        const friendship = await prisma.friendship.findFirst({
            where: {
                OR: [
                    { userId: user.id, friendId: adventure.userId, status: 'ACCEPTED' },
                    { userId: adventure.userId, friendId: user.id, status: 'ACCEPTED' }
                ]
            }
        });

        if (!friendship) {
            await interaction.editReply({
                content: 'You can only join adventures created by your friends.'
            });
            return;
        }

        // Add player to adventure
        await prisma.adventurePlayer.create({
            data: {
                adventureId: adventure.id,
                characterId: character.id
            }
        });

        // Create player-specific channel
        const category = await interaction.guild?.channels.fetch(adventure.categoryId!);
        if (category?.type === ChannelType.GuildCategory) {
            await interaction.guild?.channels.create({
                name: character.name.toLowerCase().replace(/\s+/g, '-'),
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: interaction.user.id,
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: adventure.user.discordId, // Adventure owner can see all channels
                        allow: ['ViewChannel', 'SendMessages']
                    },
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel']
                    }
                ]
            });
        }

        // Send welcome message to adventure log
        if (adventure.textChannelId) {
            const textChannel = await interaction.guild?.channels.fetch(adventure.textChannelId);
            if (textChannel?.isTextBased()) {
                await textChannel.send({
                    content: `🎉 ${character.name} has joined the adventure!`
                });
            }
        }

        await interaction.editReply({
            content: `Successfully joined the adventure "${adventure.name}" with character ${character.name}!`
        });

    } catch (error) {
        console.error('Error joining adventure:', error);
        await interaction.editReply({
            content: 'Failed to join adventure. Please try again.'
        }).catch(console.error);
    }
} 