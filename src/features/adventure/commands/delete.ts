import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { prisma } from '../../../core/prisma';
import { AdventureService } from '../services/adventure';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { deleteCategoryChannels } from '../../../shared/discord/channels';

const adventureService = new AdventureService();

export async function handleDeleteAdventure(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);

        // Lookup the database user based on discordId
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });
        if (!user) {
            await interaction.reply({
                content: 'User not registered in our system.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Fetch the adventure record to access channel IDs
        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId }
        });
        if (!adventure) {
            await interaction.reply({
                content: 'Adventure not found.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Delete all Discord channels created for this adventure
        if (interaction.guild && adventure.categoryId) {
            await deleteCategoryChannels(interaction, adventure);
        }

        // Now delete the adventure record (and dependent records) from the database.
        await adventureService.deleteAdventure(adventureId, user.id);

        // Try to send a formatted response; if it fails because the channel was deleted, DM the user instead.
        try {
            await sendFormattedResponse(interaction, {
                title: '🗑️ Adventure Deleted',
                description: 'The adventure and its associated channels have been successfully deleted.',
                fields: [
                    {
                        name: 'Adventure ID',
                        value: adventureId,
                        inline: true
                    }
                ]
            });
        } catch (error: any) {
            if (error.code === 10003 || error.code === 10062) {
                // Fallback: send a DM to the user
                await interaction.user.send('The adventure and its channels were deleted successfully.');
            } else {
                throw error;
            }
        }

        logger.info(`Adventure ${adventureId} deleted by user ${user.id}`);
    } catch (error) {
        logger.error('Error in delete adventure command:', error);
        // If replying to the interaction fails, attempt a silent fallback DM.
        try {
            await interaction.reply({
                content: translate('errors.generic'),
                flags: MessageFlags.Ephemeral
            });
        } catch (replyError: any) {
            await interaction.user.send('There was an error processing your command.');
        }
    }
} 