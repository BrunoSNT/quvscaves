import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DefaultUserService } from '../services/user';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';

const userService = new DefaultUserService();

export async function handleRegister(interaction: ChatInputCommandInteraction) {
    try {
        const nickname = interaction.options.getString('nickname', true);
        const user = await userService.register(
            interaction.user.id,
            interaction.user.username,
            nickname
        );

        await sendFormattedResponse(interaction, {
            title: '✨ Welcome to the RPG!',
            description: `You have been registered as ${nickname}. You can now create characters and join adventures!`,
            fields: [
                {
                    name: 'Next Steps',
                    value: 'Use `/create_character` to create your first character!'
                }
            ]
        });

        logger.info(`User registered: ${user.id}`);
    } catch (error) {
        logger.error('Error in register command:', error);
        await interaction.reply({
            content: translate('errors.generic'),
            flags: MessageFlags.Ephemeral
        });
    }
} 