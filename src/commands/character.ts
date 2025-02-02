import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../lib/prisma';

export async function handleCreateCharacter(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const characterName = interaction.options.getString('name', true);
        const characterClass = interaction.options.getString('class', true);

        // Get user
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!user) {
            await interaction.editReply({
                content: 'Please register first using `/register`'
            });
            return;
        }

        // Check if character name already exists for this user
        const existingCharacter = await prisma.character.findFirst({
            where: {
                name: characterName,
                userId: user.id
            }
        });

        if (existingCharacter) {
            await interaction.editReply({
                content: 'You already have a character with this name.'
            });
            return;
        }

        // Create character
        const character = await prisma.character.create({
            data: {
                name: characterName,
                class: characterClass,
                userId: user.id
            }
        });

        await interaction.editReply({
            content: `✨ Character created!\n` +
                    `**${character.name}** (${character.class})\n` +
                    `Level ${character.level} • HP: ${character.health} • MP: ${character.mana}`
        });

    } catch (error) {
        console.error('Error creating character:', error);
        await interaction.editReply({
            content: 'Failed to create character. Please try again.'
        }).catch(console.error);
    }
} 