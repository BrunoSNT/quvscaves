import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage } from '../../types/game';

export async function handleJoinAdventure(interaction: ChatInputCommandInteraction) {
    try {
        const adventureId = interaction.options.getString('adventure_id', true);
        const characterName = interaction.options.getString('character_name', true);

        const adventure = await prisma.adventure.findFirst({
            where: { 
                id: adventureId,
                status: 'ACTIVE'
            }
        });

        if (!adventure) {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.adventureNotFound,
                ephemeral: true
            });
            return;
        }

        const character = await prisma.character.findFirst({
            where: {
                name: characterName,
                userId: interaction.user.id
            }
        });

        if (!character) {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotFound,
                ephemeral: true
            });
            return;
        }

        await prisma.adventurePlayer.create({
            data: {
                adventureId,
                characterId: character.id
            }
        });

        await interaction.reply({
            content: `Successfully joined the adventure with ${character.name}!`,
            ephemeral: false
        });

    } catch (error) {
        logger.error('Error joining adventure:', error);
        await interaction.reply({
            content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
            ephemeral: true
        });
    }
} 