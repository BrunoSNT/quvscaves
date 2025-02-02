import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../lib/prisma';

export async function handleAddFriend(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const friendDiscordId = interaction.options.getUser('user', true).id;
        
        // Get both users
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });
        
        const friend = await prisma.user.findUnique({
            where: { discordId: friendDiscordId }
        });

        if (!user || !friend) {
            await interaction.editReply({
                content: 'Both users need to be registered to add friends.'
            });
            return;
        }

        // Check if they're already friends or if there's a pending request
        const existingFriendship = await prisma.friendship.findFirst({
            where: {
                OR: [
                    { userId: user.id, friendId: friend.id },
                    { userId: friend.id, friendId: user.id }
                ]
            }
        });

        if (existingFriendship) {
            if (existingFriendship.status === 'ACCEPTED') {
                await interaction.editReply({
                    content: 'You are already friends with this user.'
                });
            } else if (existingFriendship.userId === user.id) {
                await interaction.editReply({
                    content: 'You have already sent a friend request to this user.'
                });
            } else {
                // Auto-accept if there's a pending request from the other user
                await prisma.friendship.update({
                    where: { id: existingFriendship.id },
                    data: { status: 'ACCEPTED' }
                });
                await interaction.editReply({
                    content: `You are now friends with ${friend.username}! 🎉\n(They had already sent you a request)`
                });
            }
            return;
        }

        // Create friendship request
        await prisma.friendship.create({
            data: {
                userId: user.id,
                friendId: friend.id,
                status: 'PENDING'
            }
        });

        await interaction.editReply({
            content: `Friend request sent to ${friend.username}!`
        });

    } catch (error) {
        console.error('Error adding friend:', error);
        await interaction.editReply({
            content: 'Failed to add friend. Please try again.'
        }).catch(console.error);
    }
}

export async function handleAcceptFriend(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const requestId = interaction.options.getString('request_id', true);
        
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first using `/register`'
            });
            return;
        }

        // Find the friendship request
        const friendship = await prisma.friendship.findUnique({
            where: { id: requestId },
            include: { 
                user: true,
                friend: true
            }
        });

        if (!friendship) {
            await interaction.editReply({
                content: 'Friend request not found.'
            });
            return;
        }

        // Check if this user is the intended recipient
        if (friendship.friendId !== user.id) {
            await interaction.editReply({
                content: 'This friend request was not sent to you.'
            });
            return;
        }

        // Check if request is still pending
        if (friendship.status !== 'PENDING') {
            await interaction.editReply({
                content: 'This friend request has already been processed.'
            });
            return;
        }

        // Check for and delete any reverse pending requests
        await prisma.friendship.deleteMany({
            where: {
                userId: friendship.friendId,
                friendId: friendship.userId,
                status: 'PENDING'
            }
        });

        // Accept the friendship
        await prisma.friendship.update({
            where: { id: requestId },
            data: { status: 'ACCEPTED' }
        });

        await interaction.editReply({
            content: `You are now friends with ${friendship.user.username}! 🎉`
        });

    } catch (error) {
        console.error('Error accepting friend:', error);
        await interaction.editReply({
            content: 'Failed to accept friend request. Please try again.'
        }).catch(console.error);
    }
}

export async function handleRemoveFriend(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const friendDiscordId = interaction.options.getUser('user', true).id;
        
        // Get both users
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });
        
        const friend = await prisma.user.findUnique({
            where: { discordId: friendDiscordId }
        });

        if (!user || !friend) {
            await interaction.editReply({
                content: 'User not found.'
            });
            return;
        }

        // Find and delete friendship
        const friendship = await prisma.friendship.findFirst({
            where: {
                OR: [
                    { userId: user.id, friendId: friend.id },
                    { userId: friend.id, friendId: user.id }
                ],
                status: 'ACCEPTED'
            }
        });

        if (!friendship) {
            await interaction.editReply({
                content: 'You are not friends with this user.'
            });
            return;
        }

        // Delete the friendship
        await prisma.friendship.delete({
            where: { id: friendship.id }
        });

        await interaction.editReply({
            content: `Removed ${friend.username} from your friend list.`
        });

    } catch (error) {
        console.error('Error removing friend:', error);
        await interaction.editReply({
            content: 'Failed to remove friend. Please try again.'
        }).catch(console.error);
    }
}

export async function handleListFriendRequests(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first using `/register`'
            });
            return;
        }

        // Get all friendships for the user
        const friendships = await prisma.friendship.findMany({
            where: {
                OR: [
                    { userId: user.id },
                    { friendId: user.id }
                ]
            },
            include: {
                user: true,
                friend: true
            }
        });

        // Separate friendships by status
        const accepted = friendships.filter(f => f.status === 'ACCEPTED');
        const incoming = friendships.filter(f => f.status === 'PENDING' && f.friendId === user.id);
        const outgoing = friendships.filter(f => f.status === 'PENDING' && f.userId === user.id);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('👥 Friends & Requests')
            .addFields(
                {
                    name: '🤝 Current Friends',
                    value: accepted.length > 0 
                        ? accepted.map(f => {
                            const friend = f.userId === user.id ? f.friend : f.user;
                            return `• ${friend.username}`;
                        }).join('\n')
                        : 'No friends yet',
                },
                {
                    name: '📥 Incoming Requests',
                    value: incoming.length > 0 
                        ? incoming.map(f => 
                            `• From: ${f.user.username} (ID: \`${f.id}\`)`
                        ).join('\n')
                        : 'No incoming requests',
                },
                {
                    name: '📤 Outgoing Requests',
                    value: outgoing.length > 0
                        ? outgoing.map(f => 
                            `• To: ${f.friend.username}`
                        ).join('\n')
                        : 'No outgoing requests',
                }
            )
            .setFooter({ 
                text: 'Use /accept_friend [request_id] to accept a request' 
            });

        await interaction.editReply({
            embeds: [embed]
        });

    } catch (error) {
        console.error('Error listing friends:', error);
        await interaction.editReply({
            content: 'Failed to list friends. Please try again.'
        }).catch(console.error);
    }
}

export async function handleListFriends(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                friends: {
                    where: { status: 'ACCEPTED' },
                    include: { friend: true }
                },
                friendOf: {
                    where: { status: 'ACCEPTED' },
                    include: { user: true }
                }
            }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first using `/register`'
            });
            return;
        }

        // Combine both directions of friendships
        const allFriends = [
            ...user.friends.map(f => f.friend),
            ...user.friendOf.map(f => f.user)
        ];

        if (allFriends.length === 0) {
            await interaction.editReply({
                content: 'You have no friends yet. Use `/add_friend` to add some friends!'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('👥 Your Friends')
            .setDescription(allFriends.map(friend => 
                `• **${friend.username}**\n` +
                `  Joined: ${new Date(friend.createdAt).toLocaleDateString()}`
            ).join('\n\n'))
            .setFooter({ 
                text: 'Use /add_friend to add more friends!' 
            });

        await interaction.editReply({
            embeds: [embed]
        });

    } catch (error) {
        console.error('Error listing friends:', error);
        await interaction.editReply({
            content: 'Failed to list friends. Please try again.'
        }).catch(console.error);
    }
} 