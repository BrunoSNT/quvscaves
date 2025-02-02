"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCreateCharacter = handleCreateCharacter;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function handleCreateCharacter(interaction) {
    try {
        const name = interaction.options.getString('name', true);
        const characterClass = interaction.options.getString('class', true);
        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });
        if (!user) {
            await interaction.reply({
                content: 'Please register first using `/register`',
                ephemeral: true
            });
            return;
        }
        const character = await prisma.character.create({
            data: {
                name,
                class: characterClass,
                adventure: {
                    create: {
                        name: `${name}'s Adventure`,
                        status: 'ACTIVE',
                        userId: user.id
                    }
                }
            }
        });
        await interaction.reply({
            content: `✨ Character ${name} (${characterClass}) created! Use /start_adventure to begin your journey.`,
            ephemeral: true
        });
    }
    catch (error) {
        console.error('Error creating character:', error);
        await interaction.reply({
            content: 'Failed to create character. Please try again.',
            ephemeral: true
        });
    }
}
