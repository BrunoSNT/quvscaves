import { ChatInputCommandInteraction, ButtonStyle, MessageFlags, VoiceChannel, ChannelType, BaseGuildVoiceChannel, GuildVoiceChannelResolvable } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { logger, prettyPrintLog } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { generateResponse } from '../../../ai/gamemaster';
import { prisma } from '../../../core/prisma';
import { VoiceConfig } from '../../voice/types';
import { getVoiceService } from '../../voice/services';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnection } from '@discordjs/voice';
import { Readable } from 'stream';
import { GameContext } from '../../../shared/game/types';
import { Adventure } from '../types';
import chalk from 'chalk';

const adventureService = new AdventureService();

function splitIntoSentences(text: string): string[] {
    // Split on periods, exclamation marks, or question marks followed by spaces or end of string
    return text.split(/(?<=[.!?])\s+|\s*$/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

// @ts-ignore - Discord.js types issue with VoiceChannel
async function playNarration(channel: GuildVoiceChannelResolvable, texts: string[], config: VoiceConfig): Promise<{ startedPlaying: Promise<void>, finished: Promise<void> }> {
    try {
        const voiceService = await getVoiceService(config.provider);
        const connection: VoiceConnection = joinVoiceChannel({
            channelId: (channel as VoiceChannel).id,
            guildId: (channel as VoiceChannel).guild.id,
            adapterCreator: (channel as VoiceChannel).guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        // Split texts into sentences
        const narrationSentences = texts[0] ? splitIntoSentences(texts[0]) : [];
        const atmosphereSentences = texts[1] ? splitIntoSentences(texts[1]) : [];
        
        // Combine all sentences, keeping track of which are narration vs atmosphere
        const allSentences = [
            ...narrationSentences.map(s => ({ text: s, type: 'narration' })),
            ...atmosphereSentences.map(s => ({ text: s, type: 'atmosphere' }))
        ];

        let startedPlayingResolveFn: (() => void) | null = null;
        let finishedResolveFn: (() => void) | null = null;
        let startedPlayingRejectFn: ((error: Error) => void) | null = null;
        let finishedRejectFn: ((error: Error) => void) | null = null;

        const startedPlaying = new Promise<void>((resolve, reject) => {
            startedPlayingResolveFn = resolve;
            startedPlayingRejectFn = reject;
        });

        const finished = new Promise<void>((resolve, reject) => {
            finishedResolveFn = resolve;
            finishedRejectFn = reject;
        });

        let currentIndex = 0;
        let hasStartedPlaying = false;
        let nextBuffer: Buffer | null = null;
        let isProcessingNext = false;

        const requestNextSentence = async () => {
            if (currentIndex + 1 >= allSentences.length || isProcessingNext) return;
            
            isProcessingNext = true;
            const nextSentence = allSentences[currentIndex + 1];
            try {
                nextBuffer = await voiceService.speak(nextSentence.text, config);
            } catch (error) {
                logger.error(`Error pre-processing next sentence: ${nextSentence.text}`, error);
                nextBuffer = null;
            }
            isProcessingNext = false;
        };

        const playNextSentence = async () => {
            if (currentIndex >= allSentences.length) {
                finishedResolveFn?.();
                return;
            }

            const { text } = allSentences[currentIndex];
            try {
                let buffer: Buffer | null;
                
                // Use pre-fetched buffer if available
                if (currentIndex > 0 && nextBuffer) {
                    buffer = nextBuffer;
                    nextBuffer = null;
                } else {
                    buffer = await voiceService.speak(text, config);
                }

                if (!buffer) {
                    currentIndex++;
                    return playNextSentence();
                }

                const stream = Readable.from(buffer);
                const resource = createAudioResource(stream);
                player.play(resource);

                if (!hasStartedPlaying) {
                    hasStartedPlaying = true;
                    startedPlayingResolveFn?.();
                }

                // Start requesting next sentence as soon as current starts playing
                requestNextSentence();
                
                currentIndex++;
            } catch (error) {
                logger.error(`Error processing sentence: ${text}`, error);
                currentIndex++;
                return playNextSentence();
            }
        };

        player.on(AudioPlayerStatus.Playing, () => {
            // Start processing next sentence as soon as current starts playing
            requestNextSentence();
        });

        player.on(AudioPlayerStatus.Idle, () => {
            if (currentIndex < allSentences.length) {
                playNextSentence();
            } else {
                finishedResolveFn?.();
            }
        });

        player.on('error', (error) => {
            logger.error('Error in audio player:', error);
            if (!hasStartedPlaying) {
                startedPlayingRejectFn?.(error);
            }
            finishedRejectFn?.(error);
        });

        // Start playing the first sentence
        await playNextSentence();

        return { startedPlaying, finished };
    } catch (error) {
        logger.error('Error in playNarration:', error);
        throw error;
    }
}

async function handleActionResponse(interaction: ChatInputCommandInteraction | any, context: GameContext, action: string) {
    try {
        // First, display the user's action in a new message
        const channel = interaction.channel;
        const actionMessage = await channel.send({
            embeds: [{
                title: `🎭 ${context.characters[0].name.charAt(0).toUpperCase() + context.characters[0].name.slice(1)} action`,
                description: action,
                color: 0x3498db,
            }]
        });

        const response = await generateResponse(context);
        if (!response || typeof response !== 'string') {
            throw new Error('Invalid AI response format');
        }

        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response);
        } catch (parseError) {
            logger.error('Failed to parse AI response:', parseError);
            throw new Error('Invalid JSON response from AI');
        }

        const narrationText = context.language === 'en-US' 
            ? parsedResponse.narration
            : parsedResponse.narracao;
        
        const atmosphereText = context.language === 'en-US'
            ? parsedResponse.atmosphere
            : parsedResponse.atmosfera;

        const formattedResponse = context.language === 'en-US' 
            ? `📖 **Narration**\n${parsedResponse.narration}\n\n🌍 **Atmosphere**\n${parsedResponse.atmosphere}\n\n⚔️ **Available Actions**\n${parsedResponse.available_actions.map((a: string) => `• ${a}`).join('\n')}`
            : `📖 **Narração**\n${parsedResponse.narracao}\n\n🌍 **Atmosfera**\n${parsedResponse.atmosfera}\n\n⚔️ **Ações Disponíveis**\n${parsedResponse.acoes_disponiveis.map((a: string) => `• ${a}`).join('\n')}`;

        const suggestedActions = context.language === 'en-US'
            ? parsedResponse.available_actions
            : parsedResponse.acoes_disponiveis;

        // Handle voice if enabled
        let voicePromises = { startedPlaying: Promise.resolve(), finished: Promise.resolve() };
        if (context.adventure?.voiceType !== 'NONE' && interaction.guild && context.adventure?.categoryId) {
            const category = interaction.guild.channels.cache.get(context.adventure.categoryId);
            if (category?.type === ChannelType.GuildCategory) {
                const voiceChannel = category.children.cache.find(
                    (channel: { name: string; type: ChannelType; }) => channel.name.toLowerCase() === 'table' && 
                    channel.type === ChannelType.GuildVoice
                ) as VoiceChannel;

                if (voiceChannel) {
                    try {
                        logger.info(`Attempting to join voice channel ${voiceChannel.name} in ${category.name}`);
                        
                        const voiceConfig: VoiceConfig = {
                            provider: context.adventure.voiceType === 'ELEVENLABS' ? 'ELEVENLABS' : 
                                     context.adventure.voiceType === 'KOKORO' ? 'KOKORO' : 'DISCORD',
                            language: context.language,
                            ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
                        };

                        voicePromises = await playNarration(voiceChannel, [narrationText, atmosphereText], voiceConfig);
                    } catch (voiceError) {
                        logger.error('Error in voice playback:', voiceError);
                    }
                }
            }
        }

        // Wait for first sentence to start playing before showing the response
        await voicePromises.startedPlaying;

        // Display the response text without buttons
        const responseMessage = await channel.send({
            embeds: [{
                title: '🎭 Action Result',
                description: formattedResponse,
                color: 0x99ff99,
            }]
        });

        // Wait for all audio to finish before adding buttons
        try {
            await voicePromises.finished;
        } catch (error) {
            logger.error('Error waiting for voice playback to finish:', error);
        }

        // Add the action buttons
        const buttons = createActionButtons(suggestedActions);
        const components = buttons.length > 0 ? [{
            type: 1,
            components: buttons
        }] : [];

        // Edit the response message to add buttons
        await responseMessage.edit({
            embeds: [{
                title: '🎭 Action Result',
                description: formattedResponse,
                color: 0x99ff99,
            }],
            components: components
        });

        // Finally, clear the thinking state
        await interaction.editReply({ content: context.language === 'en-US' ? '✅ Action completed' : '✅ Ação concluída' });

        logger.info(`Action processed for adventure ${context.adventure?.id}`);
    } catch (error) {
        logger.error('Error handling action response:', error);
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
            await handleActionResponse(interaction, context, description);
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

export async function handleButtonAction(interaction: any, action: string) {
    try {
        await interaction.deferReply();
        logger.debug(`Player action received.  \n\n${chalk.blue('ACTION: ') + action}\n`);

        const userAdventure = await prisma.adventure.findFirst({
            where: { 
                players: {
                    some: {
                        character: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                }
            },
            include: {
                players: {
                    include: {
                        character: {
                            include: {
                                user: true,
                                CharacterSpell: true,
                                CharacterAbility: true
                            }
                        }
                    }
                }
            }
        });

        if (!userAdventure) {
            await interaction.editReply({
                content: 'You need to be in an active adventure to perform actions.',
            });
            return;
        }

        const context = await adventureService.buildGameContext(userAdventure as unknown as Adventure, action);
        await handleActionResponse(interaction, context, action);
    } catch (error) {
        logger.error('Error handling button action:', error);
        await interaction.editReply({ 
            content: 'There was an error processing your action.', 
            flags: MessageFlags.Ephemeral
        });
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

function createActionButtons(actions: string[]) {
    if (!actions || actions.length === 0) return [];

    return actions.slice(0, 5).map(action => ({
        type: 2,
        style: 1,
        label: action.substring(0, 80),
        custom_id: `action:${action.substring(0, 80)}`
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