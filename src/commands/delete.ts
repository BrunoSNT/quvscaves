import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { prisma } from '../lib/prisma';

export async function handleDeleteCharacter(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const characterId = interaction.options.getString('character_id', true);

        // Find the character
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                user: true,
                adventurePlayers: {
                    include: {
                        adventure: true
                    }
                }
            }
        });

        if (!character) {
            await interaction.editReply({
                content: 'Character not found.'
            });
            return;
        }

        // Check if user owns the character
        if (character.userId !== (await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        }))?.id) {
            await interaction.editReply({
                content: 'You can only delete your own characters.'
            });
            return;
        }

        // Check if character is in any active adventures
        const activeAdventures = character.adventurePlayers.filter(
            ap => ap.adventure.status === 'ACTIVE'
        );

        if (activeAdventures.length > 0) {
            await interaction.editReply({
                content: 'Cannot delete character while they are in active adventures.'
            });
            return;
        }

        // Delete the character
        await prisma.character.delete({
            where: { id: characterId }
        });

        await interaction.editReply({
            content: `Character ${character.name} has been deleted.`
        });

    } catch (error) {
        console.error('Error deleting character:', error);
        await interaction.editReply({
            content: 'Failed to delete character. Please try again.'
        }).catch(console.error);
    }
}

export async function handleDeleteAdventure(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const adventureId = interaction.options.getString('adventure_id', true);

        // Find the adventure with its relationships
        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId },
            include: {
                players: true,
                scenes: true,
                user: true
            }
        });

        if (!adventure) {
            await interaction.editReply({
                content: 'Adventure not found.'
            });
            return;
        }

        // Check if user owns the adventure
        if (adventure.userId !== (await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        }))?.id) {
            await interaction.editReply({
                content: 'You can only delete adventures you created.'
            });
            return;
        }

        // Delete related channels if they exist
        if (adventure.categoryId) {
            try {
                const category = await interaction.guild?.channels.fetch(adventure.categoryId).catch(() => null);
                if (category) {
                    // Delete all channels in the category
                    const channels = interaction.guild?.channels.cache.filter(
                        channel => channel.parentId === category.id
                    );
                    
                    // Delete channels one by one with error handling
                    for (const channel of channels?.values() ?? []) {
                        await channel.delete().catch(err => {
                            console.error(`Failed to delete channel ${channel.name}:`, err);
                        });
                    }
                    
                    // Delete the category itself
                    await category.delete().catch(err => {
                        console.error('Failed to delete category:', err);
                    });
                }
            } catch (err) {
                console.error('Error handling Discord channels:', err);
                // Continue with database deletion even if channel deletion fails
            }
        }

        // Delete all related data in the correct order
        await prisma.$transaction(async (prisma) => {
            // 1. Delete adventure players
            await prisma.adventurePlayer.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 2. Delete scenes
            await prisma.scene.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 3. Delete inventory items
            await prisma.inventoryItem.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 4. Finally delete the adventure
            await prisma.adventure.delete({
                where: { id: adventure.id }
            });
        });

        await interaction.editReply({
            content: 'Adventure and all related channels have been deleted.'
        });

    } catch (error) {
        console.error('Error deleting adventure:', error);
        await interaction.editReply({
            content: 'Failed to delete adventure. Please try again.'
        }).catch(console.error);
    }
} 