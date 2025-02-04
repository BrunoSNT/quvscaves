import { ChatInputCommandInteraction } from 'discord.js';
import { prisma, type PrismaClient } from '../lib/prisma';
import { logger } from '../utils/logger';

export async function handleDeleteCharacter(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const characterId = interaction.options.getString('character_id', true);

        // Find the character
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                user: true,
                adventures: {
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
        const activeAdventures = character.adventures.filter(
            (ap: { adventure: { status: string } }) => ap.adventure.status === 'ACTIVE'
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

        // Send initial response that we're processing
        await interaction.editReply({
            content: 'Deleting adventure and related channels...'
        });

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
                            logger.error(`Failed to delete channel ${channel.name}:`, err);
                        });
                    }
                    
                    // Delete the category itself
                    await category.delete().catch(err => {
                        logger.error('Failed to delete category:', err);
                    });
                }
            } catch (err) {
                logger.error('Error handling Discord channels:', err);
                // Continue with database deletion even if channel deletion fails
            }
        }

        // Delete all related data in the correct order
        await prisma.$transaction(async (tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => {
            // 1. Delete adventure players
            await tx.adventurePlayer.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 2. Delete scenes
            await tx.scene.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 3. Delete inventory items
            await tx.inventoryItem.deleteMany({
                where: { adventureId: adventure.id }
            });

            // 4. Finally delete the adventure
            await tx.adventure.delete({
                where: { id: adventure.id }
            });
        });

        // Send final success message
        await interaction.followUp({
            content: 'Adventure and all related channels have been deleted.',
            ephemeral: true
        });

    } catch (error) {
        logger.error('Error deleting adventure:', error);
        // Use followUp instead of editReply for error message
        await interaction.followUp({
            content: 'Failed to delete adventure. Please try again.',
            ephemeral: true
        }).catch(() => {
            // If even followUp fails, log it but don't throw
            logger.error('Failed to send error message to user');
        });
    }
} 