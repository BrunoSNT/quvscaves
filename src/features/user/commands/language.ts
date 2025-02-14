import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { LanguageService } from '../services/language';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { SUPPORTED_LANGUAGES } from '../../../shared/i18n/types';
import { getLanguageFlag, getLanguageName } from '../../../shared/i18n/language';

const languageService = new LanguageService();

export async function handleSetLanguage(interaction: ChatInputCommandInteraction) {
    try {
        const language = interaction.options.getString('language', true);
        await languageService.setUserLanguage(interaction.user.id, language);

        const flag = getLanguageFlag(language);
        const name = getLanguageName(language);

        await sendFormattedResponse(interaction, {
            title: `${flag} Language Updated`,
            description: `Your language has been set to ${name}`,
            fields: [
                {
                    name: 'Available Languages',
                    value: Object.values(SUPPORTED_LANGUAGES)
                        .map(lang => `${lang.flag} ${lang.name} (${lang.code})`)
                        .join('\n'),
                    inline: false
                }
            ]
        });

        logger.info(`Language updated for user ${interaction.user.id} to ${language}`);
    } catch (error) {
        logger.error('Error in set language command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 