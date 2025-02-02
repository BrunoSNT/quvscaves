import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../lib/prisma';

export async function handleListCharacters(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                characters: true
            }
        });

        if (!user || user.characters.length === 0) {
            await interaction.editReply({
                content: 'You have no characters. Create one using `/create_character`'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🎭 Your Characters')
            .setDescription(user.characters.map(char => 
                `**${char.name}** (${char.class})\n` +
                `Level ${char.level} • HP: ${char.health} • MP: ${char.mana}\n` +
                `ID: \`${char.id}\``
            ).join('\n\n'));

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error listing characters:', error);
        await interaction.editReply({
            content: 'Failed to list characters. Please try again.'
        }).catch(console.error);
    }
}

export async function handleListAdventures(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const user = await prisma.user.findUnique({
            where: { discordId: interaction.user.id },
            include: {
                adventures: {
                    include: {
                        players: {
                            include: {
                                character: true
                            }
                        }
                    }
                }
            }
        });

        if (!user || user.adventures.length === 0) {
            await interaction.editReply({
                content: 'You have no adventures. Start one using `/start_adventure`'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🎲 Your Adventures')
            .setDescription(user.adventures.map(adv => 
                `**${adv.name}** (${adv.status})\n` +
                `Players: ${adv.players.map(p => p.character.name).join(', ')}\n` +
                `ID: \`${adv.id}\``
            ).join('\n\n'));

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error listing adventures:', error);
        await interaction.editReply({
            content: 'Failed to list adventures. Please try again.'
        }).catch(console.error);
    }
} 