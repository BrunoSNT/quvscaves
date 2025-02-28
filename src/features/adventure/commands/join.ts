import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger, formatGenericOutput } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { prisma } from '../../../core/prisma';

const adventureService = new AdventureService();

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        logger.info(`Attempting to join adventure ${adventureId} with character ${characterName}`);

        // Look up the database user based on their Discord ID
        const dbUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
        });
        
        if (!dbUser) {
            throw new Error('User not registered. Please use /register first.');
        }

        // Use the database user id (UUID) instead of Discord ID
        const userId = dbUser.id;

        const adventure = await adventureService.joinAdventure(
            adventureId,
            userId,
            characterName
        );

        await sendFormattedResponse(interaction, {
            title: '🎲 Joined Adventure!',
            description: `You have joined "${adventure.name}" with your character ${characterName}.`,
            fields: [
                {
                    name: 'Players',
                    value: adventure.players.map(p => p.character!.name).join(', '),
                    inline: true
                }
            ]
        });

        logger.info(`User ${userId} joined adventure ${adventureId}`);
    } catch (error) {
        // Log the full error details
        logger.error('Error in join adventure command: ' + formatGenericOutput(JSON.stringify({
            error: error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
            } : error,
            adventureId: interaction.options.getString('adventure_id'),
            characterName: interaction.options.getString('character_name'),
            userId: interaction.user.id
        })));
        
        // Provide a more helpful error message to the user
        let errorMessage = translate('errors.generic');
        if (error instanceof Error) {
            if (error.message.includes('Character not found')) {
                errorMessage = 'Character not found. Please check the character name and try again.';
            } else if (error.message.includes('Adventure not found')) {
                errorMessage = 'Adventure not found. Please check the adventure ID and try again.';
            } else if (error.message.includes('already in this adventure')) {
                errorMessage = 'You are already in this adventure with this character.';
            } else if (error.message.includes('User not registered')) {
                errorMessage = 'You need to register first using /register.';
            }
        }
        
        await interaction.reply({
            content: errorMessage,
            flags: MessageFlags.Ephemeral
        });
    }
} 