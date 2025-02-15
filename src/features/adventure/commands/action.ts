import { ChatInputCommandInteraction, ButtonStyle, MessageFlags, VoiceChannel, ChannelType } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { logger, prettyPrintLog } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { generateResponse } from '../../../ai/gamemaster';
import { prisma } from '../../../core/prisma';
import { VoiceConfig } from '../../voice/types';
import { getVoiceService } from '../../voice/services';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import { Readable } from 'stream';

const adventureService = new AdventureService();

async function playNarration(channel: VoiceChannel, texts: string[], config: VoiceConfig) {
    try {
        const voiceService = await getVoiceService(config.provider);
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        // Play each text segment sequentially
        for (const text of texts) {
            if (!text.trim()) continue;
            
            logger.debug('Sending text to TTS:', text);
            const audioBuffer = await voiceService.speak(text, config);
            
            const stream = Readable.from(audioBuffer);
            const resource = createAudioResource(stream);
            
            player.play(resource);

            // Wait for the current segment to finish before playing the next
            await new Promise((resolve, reject) => {
                player.on(AudioPlayerStatus.Idle, () => resolve(true));
                player.on('error', (error) => {
                    logger.error('Error playing audio segment:', error);
                    reject(error);
                });
            });
        }

        return true;
    } catch (error) {
        logger.error('Error in playNarration:', error);
        throw error;
    }
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        const description = interaction.options.getString('description', true);
        logger.debug(`User ${interaction.user.id} invoked /action with description: ${description}`);

        const dbUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!dbUser) {
            await interaction.editReply({
                content: 'You need to register first using /register.',
            });
            return;
        }

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
            logger.debug('Raw AI response:', response);
            
            if (!response || typeof response !== 'string') {
                throw new Error('Invalid AI response format');
            }

            // First parse the JSON response
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(response);
            } catch (parseError) {
                logger.error('Failed to parse AI response:', parseError);
                throw new Error('Invalid JSON response from AI');
            }

            // Extract text for narration and atmosphere separately
            const narrationText = context.language === 'en-US' 
                ? parsedResponse.narration
                : parsedResponse.narracao;
            
            const atmosphereText = context.language === 'en-US'
                ? parsedResponse.atmosphere
                : parsedResponse.atmosfera;

            // Find the Table voice channel
            const category = interaction.guild?.channels.cache.get(adventure.categoryId!);
            if (category?.type === ChannelType.GuildCategory) {
                const voiceChannel = category.children.cache.find(
                    channel => channel.name.toLowerCase() === 'table' && 
                    channel.type === ChannelType.GuildVoice
                ) as VoiceChannel;

                if (voiceChannel && adventure.voiceType !== 'NONE') {
                    try {
                        logger.info(`Attempting to join voice channel ${voiceChannel.name} in ${category.name}`);
                        
                        const voiceConfig: VoiceConfig = {
                            provider: adventure.voiceType === 'ELEVENLABS' ? 'ELEVENLABS' : 
                                     adventure.voiceType === 'KOKORO' ? 'KOKORO' : 'DISCORD',
                            language: context.language,
                            ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
                        };

                        // Play narration and atmosphere as separate segments
                        await playNarration(voiceChannel, [narrationText, atmosphereText], voiceConfig);
                    } catch (voiceError) {
                        logger.error('Error in voice playback:', voiceError);
                    }
                } else {
                    if (!voiceChannel) {
                        logger.warn('No "Table" voice channel found in category:', category.name);
                    } else if (adventure.voiceType === 'NONE') {
                        logger.debug('Voice is disabled for this adventure');
                    }
                }
            } else {
                logger.warn('No category found for adventure:', adventure.id);
            }

            // Format the response for Discord after JSON parsing
            const formattedResponse = context.language === 'en-US' 
                ? `📖 **Narration**\n${parsedResponse.narration}\n\n🌍 **Atmosphere**\n${parsedResponse.atmosphere}\n\n⚔️ **Available Actions**\n${parsedResponse.available_actions.map((a: string) => `• ${a}`).join('\n')}`
                : `📖 **Narração**\n${parsedResponse.narracao}\n\n🌍 **Atmosfera**\n${parsedResponse.atmosfera}\n\n⚔️ **Ações Disponíveis**\n${parsedResponse.acoes_disponiveis.map((a: string) => `• ${a}`).join('\n')}`;

            const suggestedActions = context.language === 'en-US'
                ? parsedResponse.available_actions
                : parsedResponse.acoes_disponiveis;

            const buttons = createActionButtons(suggestedActions);
            const components = buttons.length > 0 ? [{
                type: 1,
                components: buttons
            }] : [];

            await interaction.editReply({
                embeds: [{
                    title: '🎭 Action',
                    description: formattedResponse,
                    color: 0x99ff99,
                    fields: [
                        {
                            name: context.language === 'en-US' ? 'Your Action' : 'Sua Ação',
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