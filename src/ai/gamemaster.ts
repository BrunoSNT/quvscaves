import axios from 'axios';
import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../lib/prisma';
import { speakInVoiceChannel } from '../lib/voice';
import { getMessages } from '../utils/language';
import { GameContext, GameState, Character, SupportedLanguage } from '../types/game';
import { logger } from '../utils/logger';
import { getGamePrompt, buildContextString, createFallbackResponse } from '../utils/gamePrompts';

const AI_ENDPOINT = process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate';
const AI_MODEL = process.env.AI_MODEL || 'qwen2.5:14b';

interface AIResponse {
    response?: string;
    error?: string;
}

export async function generateResponse(context: GameContext): Promise<string> {
    try {
        const language = context.language;
        const prompt = getGamePrompt(language);
        const contextStr = buildContextString(context, language);

        logger.debug('Sending request to AI endpoint:', {
            endpoint: AI_ENDPOINT,
            model: AI_MODEL,
            language,
            contextLength: contextStr.length
        });

        const response = await axios.post<AIResponse>(AI_ENDPOINT, {
            model: AI_MODEL,
            prompt: prompt.intro + contextStr,
            temperature: 0.7,
            max_tokens: 2000,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["[End]", "<|end|>"],
            stream: false
        });

        logger.debug('Raw AI response:', response.data);

        if (!response?.data) {
            logger.error('No response data from AI endpoint');
            return createFallbackResponse(context);
        }

        if (response.data.error) {
            logger.error('AI endpoint returned error:', response.data.error);
            return createFallbackResponse(context);
        }

        if (!response.data.response) {
            logger.error('Empty AI response:', response.data);
            return createFallbackResponse(context);
        }

        const aiResponse = response.data.response.trim();
        if (!aiResponse) {
            logger.error('Empty AI response after trim');
            return createFallbackResponse(context);
        }

        logger.debug('Processed AI response:', {
            responseLength: aiResponse.length,
            firstLine: aiResponse.split('\n')[0]
        });

        if (!validateResponseFormat(aiResponse, language)) {
            logger.error('Invalid AI response format:', aiResponse);
            return createFallbackResponse(context);
        }

        return aiResponse;

    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error('Axios error generating AI response:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
        } else {
            logger.error('Error generating AI response:', error);
        }
        return createFallbackResponse(context);
    }
}

function validateResponseFormat(response: string, language: SupportedLanguage): boolean {
    const requiredSections = language === 'en-US' 
        ? ['[Narration]', '[Dialogue]', '[Atmosphere]', '[Suggested Choices]', '[Effects]', '[Spell Effects]']
        : ['[Narração]', '[Diálogo]', '[Atmosfera]', '[Sugestões de Ação]', '[Efeitos]', '[Efeitos Mágicos]'];
    
    return requiredSections.some(section => response.includes(section));
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        const action = interaction.options.getString('description', true);
        const adventureId = interaction.options.getString('adventureId', true);
        
        const adventure = await prisma.adventure.findFirst({
            where: { id: adventureId },
            include: {
                players: {
                    include: {
                        character: true
                    }
                },
                scenes: {
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            }
        });

        if (!adventure) {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.adventureNotFound,
                ephemeral: true
            });
            return;
        }

        const character = adventure.players[0]?.character as unknown as Character;
        if (!character) {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotFound,
                ephemeral: true
            });
            return;
        }

        const currentScene = adventure.scenes[0];
        const gameState: GameState = {
            health: character.health,
            mana: character.mana,
            inventory: [],
            questProgress: adventure.status
        };

        const context: GameContext = {
            scene: currentScene?.description || 'Starting a new adventure...',
            playerActions: [action],
            characters: [character],
            currentState: gameState,
            language: (adventure.language as SupportedLanguage) || 'en-US'
        };

        const response = await generateResponse(context);
        
        await interaction.reply({
            content: response,
            ephemeral: false
        });

        if (adventure.categoryId) {
            await speakInVoiceChannel(
                response,
                interaction.guild!,
                adventure.categoryId,
                adventureId
            ).catch(error => {
                logger.error('Error in voice playback:', error);
            });
        }

    } catch (error) {
        logger.error('Error handling player action:', error);
        await interaction.reply({
            content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
            ephemeral: true
        });
    }
}

function createLocalFallbackResponse(context: GameContext): string {
    const language = context.language;
    const isEnglish = language === 'en-US';
    
    logger.warn('Using fallback response for language:', language);

    const sections = isEnglish ? {
        narration: '[Narration] The adventure continues, though the path ahead is momentarily unclear...',
        dialogue: '[Dialogue] "Let us proceed carefully," your companion suggests.',
        atmosphere: '[Atmosphere] A moment of uncertainty hangs in the air.',
        suggestions: '[Suggested Choices]\n- Wait and observe the situation\n- Proceed with caution\n- Consult with your companions',
        effects: '[Effects] The group remains alert and ready.',
        spellEffects: '[Spell Effects] No magical effects are currently active.'
    } : {
        narration: '[Narração] A aventura continua, embora o caminho à frente esteja momentaneamente incerto...',
        dialogue: '[Diálogo] "Vamos prosseguir com cuidado," sugere seu companheiro.',
        atmosphere: '[Atmosfera] Um momento de incerteza paira no ar.',
        suggestions: '[Sugestões de Ação]\n- Aguardar e observar a situação\n- Prosseguir com cautela\n- Consultar seus companheiros',
        effects: '[Efeitos] O grupo permanece alerta e pronto.',
        spellEffects: '[Efeitos Mágicos] Nenhum efeito mágico está ativo no momento.'
    };

    return Object.values(sections).join('\n\n');
} 