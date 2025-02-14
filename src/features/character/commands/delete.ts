import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { prisma } from '../../../core/prisma';
import { DefaultCharacterService } from '../services/character';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

// Create an instance of the character service.
const characterService = new DefaultCharacterService();

export async function handleDeleteCharacter(interaction: ChatInputCommandInteraction) {
    try {
        const characterId = interaction.options.getString('character_id', true);

        // Look up the database user based on their Discord ID
        const dbUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
        });
        if (!dbUser) {
            await interaction.reply({
                content: 'You must register first using /register.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Fetch the character (with its associated user)
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: { user: true },
        });
        if (!character) {
            await interaction.reply({
                content: 'Character not found.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Check if the character belongs to the caller.
        if (character.user.id !== dbUser.id) {
            await interaction.reply({
                content: 'Not authorized to delete this character.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Use the instantiated service to delete the character.
        await characterService.deleteCharacter(characterId, dbUser.id);

        await interaction.reply({
            content: 'Character deleted successfully.',
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error in delete character command:', error);
        await interaction.reply({
            content:
                'Failed to delete character: ' +
                (error instanceof Error ? error.message : ''),
            flags: MessageFlags.Ephemeral,
        });
    }
} 