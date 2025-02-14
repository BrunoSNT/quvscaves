import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const adventureService = new AdventureService();

export async function handleListAdventures(interaction: ChatInputCommandInteraction) {
    try {
        const adventures = await adventureService.listAdventures(interaction.user.id);

        if (adventures.length === 0) {
            await interaction.reply({
                content: 'You have no active adventures. Use `/create_adventure` to start one!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🗺️ Your Adventures')
            .setColor(0x0099FF)
            .setDescription(`You have ${adventures.length} adventure(s):`)
            .addFields(
                adventures.map(adv => ({
                    name: adv.name,
                    value: `Players: ${adv.players.map(p => p.character?.name).join(', ')}\Description: ${adv.description}`,
                    inline: true
                }))
            );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        logger.info(`Listed adventures for user ${interaction.user.id}`);
    } catch (error) {
        logger.error('Error in list adventures command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
}
