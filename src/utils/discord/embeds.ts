import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, BaseGuildTextChannel, Guild } from 'discord.js';
import { ResponseSections } from '../adventure';
import { SupportedLanguage } from '../../types/game';
import { logger } from '../logger';
import { speakInVoiceChannel, voiceEvents } from '../../lib/voice';

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

export function createAdventureEmbed(
    characterName: string,
    action: string,
    sections: ResponseSections,
    language: SupportedLanguage
): EmbedBuilder {
    // Determine scene type from narrative content
    const sceneType = sections.narration.toLowerCase().includes('forest') ? 'forest' :
                     sections.narration.toLowerCase().includes('dungeon') ? 'dungeon' :
                     sections.narration.toLowerCase().includes('town') ? 'town' : 'default';

    const { thumbnail, color } = SCENE_ASSETS[sceneType];

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎭 ${characterName}'s Adventure`)
        .setDescription(`**Last Action:** ${action}`)
        .setThumbnail(thumbnail)
        .setTimestamp();

    // Add spacing
    embed.addFields({ name: '\u200B', value: '\u200B', inline: false });

    // Add narration if present
    if (sections.narration) {
        embed.addFields({
            name: `${SECTION_EMOJIS.narration} Narration`,
            value: sections.narration,
            inline: false
        });
        embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
    }

    // Add atmosphere if present
    if (sections.atmosphere) {
        embed.addFields({
            name: `${SECTION_EMOJIS.atmosphere} Atmosphere`,
            value: sections.atmosphere,
            inline: false
        });
        embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
    }

    // Add effects if present
    if (sections.effects) {
        embed.addFields({
            name: `${SECTION_EMOJIS.effects} Effects`,
            value: sections.effects,
            inline: false
        });
        embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
    }

    // Add available actions if present
    if (sections.actions.length > 0) {
        embed.addFields({
            name: `${SECTION_EMOJIS.actions} Available Actions`,
            value: sections.actions.map(action => `• ${action}`).join('\n'),
            inline: false
        });
    }

    // Add decorative line
    embed.addFields({ name: '\u200B', value: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬', inline: false });

    embed.setFooter({ 
        text: language === 'pt-BR' ? '🎲 Use os botões abaixo para escolher sua próxima ação' : '🎲 Use the buttons below to choose your next action',
        iconURL: 'https://i.imgur.com/AfFp7pu.png'
    });

    return embed;
}

export function createActionButtons(actions: string[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    
    // Create buttons in groups of 5 (Discord's limit per row)
    for (let i = 0; i < actions.length; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        const groupActions = actions.slice(i, i + 5);
        
        groupActions.forEach((action) => {
            const buttonLabel = action.length > 80 ? action.substring(0, 77) + '...' : action;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`action:${action}`)
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
    // First send the player's action
    await channel.send({
        content: `🎭 **${characterName}**: ${action}`,
        tts: false
    });

    // Extract all sections
    const sections = extractSections(response, language);

    // Create the main story embed
    const storyEmbed = new EmbedBuilder()
        .setColor('#2B2D31')
        .setTitle('📖 Story Update')
        .setTimestamp();

    // Add narrative content
    if (sections.narration) {
        storyEmbed.addFields({
            name: '📜 Narration',
            value: sections.narration,
            inline: false
        });
    }

    // Add atmosphere if present
    if (sections.atmosphere) {
        storyEmbed.addFields({
            name: '🌟 Atmosphere',
            value: sections.atmosphere,
            inline: false
        });
    }

    // Add effects if present
    if (sections.effects) {
        storyEmbed.addFields({
            name: '✨ Effects',
            value: sections.effects,
            inline: false
        });
    }

    // Add memory if present
    if (sections.memory) {
        storyEmbed.addFields({
            name: '📜 Memory',
            value: sections.memory,
            inline: false
        });
    }

    // Add footer
    storyEmbed.setFooter({ 
        text: language === 'pt-BR' 
            ? 'Use /action para realizar uma ação personalizada'
            : 'Use /action to perform a custom action',
        iconURL: 'https://i.imgur.com/AfFp7pu.png'
    });

    // Start voice playback if enabled
    if (voiceType !== 'none' && guild && categoryId && adventureId) {
        try {
            const voiceText = extractVoiceText(response);
            if (voiceText) {
                logger.debug('Starting voice playback with text:', {
                    textLength: voiceText.length,
                    voiceType
                });

                // Create a promise that resolves when playback starts
                const playbackPromise = new Promise<void>((resolve) => {
                    voiceEvents.once('playbackStarted', (id) => {
                        if (id === adventureId) {
                            logger.debug(`Received playbackStarted event for adventure: ${adventureId}`);
                            // Send the story embed when playback starts
                            channel.send({
                                embeds: [storyEmbed],
                                tts: voiceType === 'discord'
                            });
                            resolve();
                        }
                    });
                });

                // Start voice playback (don't await it)
                speakInVoiceChannel(
                    voiceText,
                    guild,
                    categoryId,
                    adventureId,
                    voiceType,
                    language
                ).catch(error => {
                    logger.error('Error in voice playback:', error);
                    // On voice error, still send the embed
                    channel.send({
                        embeds: [storyEmbed],
                        tts: false
                    });
                });

                // Wait for playback to start or timeout after 5 seconds
                await Promise.race([
                    playbackPromise,
                    new Promise<void>((resolve) => setTimeout(() => {
                        logger.warn('Playback start timeout, sending embed anyway');
                        resolve();
                    }, 60000))
                ]);
            } else {
                logger.debug('No narrative sections found for voice playback');
                // If no voice text, just send the embed
                await channel.send({
                    embeds: [storyEmbed],
                    tts: false
                });
            }
        } catch (voiceError) {
            logger.error('Error in voice playback:', voiceError);
            // On voice error, still send the embed
            await channel.send({
                embeds: [storyEmbed],
                tts: false
            });
        }
    } else {
        // No voice playback, just send the embed
        await channel.send({
            embeds: [storyEmbed],
            tts: false
        });
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