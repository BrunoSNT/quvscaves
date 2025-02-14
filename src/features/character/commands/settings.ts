import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultCharacterService } from '../services/character';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const characterService = new DefaultCharacterService();

export async function handleCharacterSettings(interaction: ChatInputCommandInteraction) {
    try {
        const characterId = interaction.options.getString('character_id', true);

        const character = await characterService.getCharacter(characterId);
        if (!character) {
            throw new Error('Character not found');
        }

        // For now, just show character settings
        // TODO: Implement character settings modification
        await sendFormattedResponse(interaction, {
            title: '⚙️ Character Settings',
            description: `Settings for ${character.name}:`,
            fields: [
                {
                    name: 'Basic Info',
                    value: `Class: ${character.class}\nRace: ${character.race}\nLevel: ${character.level}`,
                    inline: true
                },
                {
                    name: 'Stats',
                    value: Object.entries(character.stats)
                        .map(([stat, value]) => `${stat}: ${value}`)
                        .join('\n'),
                    inline: true
                },
                {
                    name: 'Skills',
                    value: Object.entries(character.skills)
                        .map(([skill, value]) => `${skill}: ${value}`)
                        .join('\n'),
                    inline: true
                }
            ]
        });

        logger.info(`Displayed settings for character ${characterId}`);
    } catch (error) {
        logger.error('Error in character settings command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 