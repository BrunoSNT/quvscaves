import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { DefaultCharacterService } from '../services/character';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const characterService = new DefaultCharacterService();

export async function handleListCharacters(interaction: ChatInputCommandInteraction) {
    try {
        const characters = await characterService.listCharacters(interaction.user.id);

        if (characters.length === 0) {
            await interaction.reply({
                content: 'You have no characters yet. Use `/create_character` to create one!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎭 Your Characters')
            .setColor(0x0099FF)
            .setDescription(`You have ${characters.length} character(s):`)
            .addFields(
                characters.map(char => ({
                    name: `${char.name} (Level ${char.level})`,
                    value: `Class: ${char.class}\nRace: ${char.race}\nHealth: ${char.health}/${char.maxHealth}\nMana: ${char.mana}/${char.maxMana}`,
                    inline: true
                }))
            );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        logger.info(`Listed characters for user ${interaction.user.id}`);
    } catch (error) {
        logger.error('Error in list characters command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 