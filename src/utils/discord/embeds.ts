import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, BaseGuildTextChannel, Guild, TextChannel } from 'discord.js';
import { ResponseSections } from '../adventure';
import { SupportedLanguage } from '../../types/game';
import { logger } from '../logger';
import { speakInVoiceChannel, voiceEvents } from '../../lib/voice';
import { log } from 'console';

// Scene assets configuration
const SCENE_ASSETS = {
    forest: {
        thumbnail: 'https://i.imgur.com/XYZ123.png', // Replace with actual forest scene thumbnail
        color: 0x2D5A27 // Dark forest green
    },
    dungeon: {
        thumbnail: 'https://i.imgur.com/ABC456.png', // Replace with actual dungeon scene thumbnail
        color: 0x4A3B35 // Dark stone brown
    },
    town: {
        thumbnail: 'https://i.imgur.com/DEF789.png', // Replace with actual town scene thumbnail
        color: 0x8B7355 // Warm town brown
    },
    default: {
        thumbnail: 'https://i.imgur.com/AfFp7pu.png', // Default scene thumbnail
        color: 0x2B2D31 // Default dark theme color
    }
} as const;

// Emoji configuration
const SECTION_EMOJIS = {
    narration: '📜',
    atmosphere: '🌟',
    dialogue: '💬',
    effects: '✨',
    actions: '🎯',
    memory: '📜'
} as const;

interface ActionButton {
    id: string;
    label: string;
    action: string;
}

export function createActionButtons(actions: string[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    
    // Create buttons in groups of 5 (Discord's limit per row)
    for (let i = 0; i < actions.length; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        const groupActions = actions.slice(i, i + 5);
        
        groupActions.forEach((action) => {
            // Truncate action for button ID (Discord has a 100 char limit for customId)
            const truncatedActionId = action.length > 75 ? action.substring(0, 75) + '...' : action;
            // Truncate display label (Discord has an 80 char limit for button labels)
            const buttonLabel = action.length > 77 ? action.substring(0, 74) + '...' : action;
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`action:${truncatedActionId}`)
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚔️')
            );
        });
        
        rows.push(row);
    }
    
    return rows;
}

// Helper function to extract sections from AI response
export function extractSections(response: string, language: SupportedLanguage): ResponseSections {
    const sectionNames = language === 'pt-BR' 
        ? {
            narration: ['Narração', 'Narrativa'],
            atmosphere: ['Atmosfera', 'Ambiente'],
            actions: ['Ações Disponíveis', 'Sugestões de Ação', 'Ações', 'Escolhas'],
            effects: ['Efeitos', 'Status'],
            memory: ['Memória', 'História']
        }
        : {
            narration: ['Narration', 'Narrative'],
            atmosphere: ['Atmosphere', 'Environment'],
            actions: ['Available Actions', 'Actions', 'Suggested Actions', 'Choices'],
            effects: ['Effects', 'Status Effects'],
            memory: ['Memory', 'History']
        };

    const sections = response.split(/\[(?=[A-Z])/);
    
    const findSection = (sectionTypes: string[]): string => {
        const pattern = sectionTypes.map(type => `\\[${type}\\]`).join('|');
        const regex = new RegExp(`(${pattern})(.*?)(?=\\[|$)`, 's');
        const match = response.match(regex);
        return match ? match[2].trim() : '';
    };

    const extractActions = (content: string): string[] => {
        return content
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.trim().replace(/^-\s*/, ''))
            .filter(action => action.length > 0);
    };

    return {
        narration: findSection(sectionNames.narration),
        atmosphere: findSection(sectionNames.atmosphere),
        actions: extractActions(findSection(sectionNames.actions)),
        effects: findSection(sectionNames.effects),
        memory: findSection(sectionNames.memory)
    };
}

function extractVoiceText(response: string): string {
    const sections = response.split(/\[(?=[A-Z])/);
    const narrativeSections = sections.filter(section => 
        section.startsWith('Narration') || 
        section.startsWith('Narração') || 
        section.startsWith('Atmosphere') ||
        section.startsWith('Atmosfera')
    ).map(section => {
        // Clean up the section text
        return section.replace(/^(Narration|Narração|Atmosphere|Atmosfera)\]/, '').trim();
    });

    // Combine narrative sections for voice playback
    return narrativeSections.join('\n\n');
}

export interface FormattedResponseOptions {
    channel: BaseGuildTextChannel;
    characterName: string;
    action: string;
    response: string;
    language: SupportedLanguage;
    voiceType?: 'none' | 'discord' | 'elevenlabs' | 'kokoro';
    guild?: Guild;
    categoryId?: string;
    adventureId?: string;
}

export async function sendFormattedResponse({
    channel,
    characterName,
    action,
    response,
    language,
    voiceType = 'none',
    guild,
    categoryId,
    adventureId
}: FormattedResponseOptions) {
    // Extract all sections
    const sections = extractSections(response, language);

    // Determine scene type from narrative content
    const sceneType = sections.narration.toLowerCase().includes('forest') ? 'forest' :
                     sections.narration.toLowerCase().includes('dungeon') ? 'dungeon' :
                     sections.narration.toLowerCase().includes('town') ? 'town' : 'default';

    const { thumbnail, color } = SCENE_ASSETS[sceneType];

    // Create the initial story embed with basic info
    const initialEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎭 ${characterName}`)
        .setDescription(action)
        .setThumbnail(thumbnail)
        .setTimestamp();

    // Send the initial embed
    const initialMessage = await channel.send({
        embeds: [initialEmbed]
    });

    // Function to create and send the full embed
    const updateWithFullEmbed = async () => {
        // Create the full story embed
        const storyEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`🎭 ${characterName}`)
            .setDescription(action)
            .setThumbnail(thumbnail)
            .setTimestamp();

        // Add spacing
        storyEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });

        // Add narrative content
        if (sections.narration) {
            storyEmbed.addFields({
                name: `${SECTION_EMOJIS.narration} Narration`,
                value: sections.narration,
                inline: false
            });
            storyEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
        }

        // Add atmosphere if present
        if (sections.atmosphere) {
            storyEmbed.addFields({
                name: `${SECTION_EMOJIS.atmosphere} Atmosphere`,
                value: sections.atmosphere,
                inline: false
            });
            storyEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
        }

        // Add effects if present
        if (sections.effects) {
            storyEmbed.addFields({
                name: `${SECTION_EMOJIS.effects} Effects`,
                value: sections.effects,
                inline: false
            });
            storyEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
        }

        // Add memory if present
        if (sections.memory) {
            storyEmbed.addFields({
                name: `${SECTION_EMOJIS.memory} Memory`,
                value: sections.memory,
                inline: false
            });
            storyEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
        }

        // Add decorative line
        storyEmbed.addFields({ name: '\u200B', value: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬', inline: false });

        // Add footer
        storyEmbed.setFooter({ 
            text: language === 'pt-BR' 
                ? '🎲 Use os botões abaixo para escolher sua próxima ação \n Use /action para uma ação customizada'
                : '🎲 Use the buttons below to choose your next action \n Use /action for a custom action',
            iconURL: 'https://i.imgur.com/AfFp7pu.png'
        });

        // Edit the initial message with the full embed
        await initialMessage.edit({
            embeds: [storyEmbed]
        });
    };

    // Start voice playback if enabled
    if (voiceType !== 'none' && guild && categoryId && adventureId) {
        try {
            const voiceText = extractVoiceText(response);
            logger.info('voiceText', voiceText);

            if (voiceText) {
                logger.debug('Starting voice playback with text:', {
                    textLength: voiceText.length,
                    voiceType
                });

                // Create a promise that resolves when playback starts or times out
                const playbackStarted = new Promise<void>((resolve) => {
                    const timeout = setTimeout(() => {
                        logger.warn('Playback start timeout, updating embed anyway');
                        resolve();
                    }, 60000); // 60000 second timeout

                    voiceEvents.once('playbackStarted', (id) => {
                        if (id === adventureId) {
                            updateWithFullEmbed();
                            clearTimeout(timeout);
                            logger.debug(`Received playbackStarted event for adventure: ${adventureId}`);
                            resolve();
                        }
                    });
                });

                // Start voice playback
                const playbackPromise = speakInVoiceChannel(
                    voiceText,
                    guild,
                    categoryId,
                    adventureId,
                    language,
                    channel as TextChannel,
                    characterName,
                    action
                ).catch(error => {
                    logger.error('Error in voice playback:', error);
                });

                // Wait for playback to start before updating the embed
                await playbackStarted;
                
                // Wait for playback to complete
                await playbackPromise;
            } else {
                logger.debug('No narrative sections found for voice playback');
            }
        } catch (voiceError) {
            logger.error('Error in voice playback:', voiceError);
        }
    } else {
    }

    // Create and send action buttons if there are any
    if (sections.actions.length > 0) {
        const actionButtons = createActionButtons(sections.actions);
        await channel.send({
            content: language === 'pt-BR' ? '**Ações Sugeridas:**' : '**Suggested Actions:**',
            components: actionButtons,
            tts: false
        });
    }

    return sections;
} 