import { ChatInputCommandInteraction, ButtonStyle, MessageFlags } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { sendFormattedResponse } from '../../../shared/discord/embeds';
import { logger, prettyPrintLog } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { generateResponse } from '../../../ai/gamemaster';
import { prisma } from '../../../core/prisma';

const adventureService = new AdventureService();

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        // Defer the reply immediately to prevent timeout
        await interaction.deferReply();

        const description = interaction.options.getString('description', true);
        logger.debug(`User ${interaction.user.id} invoked /action with description: ${description}`);

        // First, get the database user
        const dbUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!dbUser) {
            await interaction.editReply({
                content: 'You need to register first using /register.',
            });
            return;
        }

        // Use the database user ID to find the adventure
        const adventure = await adventureService.getCurrentAdventure(dbUser.id);
        logger.debug(`Retrieved adventure for user ${dbUser.id}:`, adventure);

        if (!adventure) {
            await interaction.editReply({
                content: 'You need to be in an active adventure to perform actions.',
            });
            return;
        }

        try {
            const context = await adventureService.buildGameContext(adventure, description);
            const response = await generateResponse(context);
            logger.debug('AI response:', prettyPrintLog(response));
            if (!response || typeof response !== 'string') {
                throw new Error('Invalid AI response format');
            }

            const suggestedActions = extractSuggestedActions(response);
            const buttons = createActionButtons(suggestedActions);

            // Only include components if we have suggested actions
            const components = buttons.length > 0 ? [{
                type: 1, // ActionRow
                components: buttons
            }] : [];

            await interaction.editReply({
                embeds: [{
                    title: '🎭 Action',
                    description: response,
                    color: 0x99ff99,
                    fields: [
                        {
                            name: 'Your Action',
                            value: description,
                            inline: true
                        }
                    ]
                }],
                components: components
            });

            logger.info(`Player action processed for adventure ${adventure.id}`);
        } catch (aiError) {
            logger.error('Error generating AI response:', aiError);
            await interaction.editReply({
                content: 'Sorry, I had trouble processing your action. Please try again.',
            });
        }
    } catch (error) {
        logger.error('Error in player action command:', error);
        if (interaction.deferred) {
            await interaction.editReply({
                content: translate('errors.generic'),
            });
        } else {
            await interaction.reply({
                content: translate('errors.generic'),
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

export function extractSuggestedActions(response: string): string[] {
    try {
        // Find the [Actions] section
        const actionsMatch = response.match(/\[Actions\]([^[]*)/i);
        if (!actionsMatch) {
            // Try Portuguese section name
            const acoesMatch = response.match(/\[Ações\]([^[]*)/i);
            if (!acoesMatch) return [];
            return extractActionItems(acoesMatch[1]);
        }
        return extractActionItems(actionsMatch[1]);
    } catch (error) {
        logger.error('Error extracting actions:', error);
        return [];
    }
}

function extractActionItems(actionsText: string): string[] {
    // Split by newlines and filter for lines starting with dash/hyphen
    return actionsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'))
        .map(line => line.substring(1).trim()) // Remove the dash and trim
        .filter(action => action.length > 0)
        .slice(0, 5); // Discord limit of 5 buttons
}

export function createActionButtons(actions: string[]) {
    // Only create buttons if we have actions and limit to 5 (Discord's limit)
    if (!actions || actions.length === 0) return [];

    return actions.slice(0, 5).map(action => ({
        type: 2, // Button type
        style: 1, // Primary style
        label: action.substring(0, 80), // Discord button label limit
        custom_id: `action:${action.substring(0, 80)}` // Limit custom_id length
    }));
}

export function toGameCharacter(character: any) {
    // Convert database character to game character format
    return {
        // Implementation...
    };
}

export async function getAdventureMemory(adventureId: string) {
    // Get adventure memory entries
    // Implementation...
    return [];
} 