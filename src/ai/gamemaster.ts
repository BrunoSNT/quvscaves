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

        logger.debug('Full context for AI:', {
            prompt: prompt.intro,
            context: contextStr,
            combat: context.combat ? {
                isActive: context.combat.isActive,
                round: context.combat.round,
                currentTurn: context.combat.currentTurn,
                participants: context.combat.participants
            } : 'No combat active'
        });

        logger.debug('Sending request to AI endpoint:', {
            endpoint: AI_ENDPOINT,
            model: AI_MODEL,
            language,
            contextLength: contextStr.length
        });

        const systemPrompt = `${prompt.system}

SECTION FORMAT:
All sections MUST be formatted with square brackets, like this:
[Narration] - NOT **Narration**
[Atmosphere] - NOT **Atmosphere**
[Combat] - NOT **Combat**
[Available Actions] - NOT **Actions**
[Effects] - NOT **Effects**
[Memory] - NOT **Memory**

# Tools

You may call one or more functions to assist with the user query.

Available tools:
- updateCharacterStats: Update character's health, mana, or status effects
- addInventoryItem: Add an item to character's inventory
- createNPC: Create a new NPC in the scene
- rollDice: Roll dice for skill checks or combat
- updateQuestProgress: Update quest status and progress
- createMemory: Create a new memory entry for significant events

For each tool call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>`;

        const response = await axios.post<AIResponse>(AI_ENDPOINT, {
            model: AI_MODEL,
            prompt: `<|im_start|>system
${prompt.intro}

${systemPrompt}
<|im_end|>
<|im_start|>user
${contextStr}
<|im_end|>
<|im_start|>assistant
`,
            temperature: 0.7,
            max_tokens: 2000,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["<|im_end|>"],
            stream: false
        });

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

        // Handle tool calls in the response
        const toolCalls = aiResponse.match(/<tool_call>(.*?)<\/tool_call>/gs);
        if (toolCalls) {
            for (const toolCall of toolCalls) {
                try {
                    const toolData = JSON.parse(toolCall.replace(/<\/?tool_call>/g, ''));
                    logger.debug('Processing tool call:', toolData);
                    // TODO: Implement tool call handling
                    // await handleToolCall(toolData, context);
                } catch (error) {
                    logger.error('Error processing tool call:', error);
                }
            }
        }

        // Remove tool calls from final response
        const cleanResponse = aiResponse.replace(/<tool_call>.*?<\/tool_call>/gs, '').trim();

        if (!validateResponseFormat(cleanResponse, language)) {
            logger.error('Invalid AI response format:', cleanResponse);
            return createFallbackResponse(context);
        }

        return cleanResponse;

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
    const sectionNames = language === 'en-US' 
        ? {
            narration: ['Narration', 'Narrative'],
            atmosphere: ['Atmosphere', 'Environment'],
            combat: ['Combat', 'Battle'],
            actions: ['Available Actions', 'Actions', 'Suggested Actions', 'Choices'],
            effects: ['Effects', 'Status Effects'],
            memory: ['Memory', 'History']
        }
        : {
            narration: ['Narração', 'Narrativa'],
            atmosphere: ['Atmosfera', 'Ambiente'],
            combat: ['Combate', 'Batalha'],
            actions: ['Ações Disponíveis', 'Sugestões de Ação', 'Ações', 'Escolhas'],
            effects: ['Efeitos', 'Status'],
            memory: ['Memória', 'História']
        };
    
    // Create patterns for sections
    const patterns = Object.values(sectionNames).flat().map(name => 
        `\\[${name}\\]`  // Only accept bracket format
    );

    // Get unique section types present (ignoring duplicates)
    const uniqueSectionTypes = new Set(
        patterns
            .map(pattern => {
                const matches = response.match(new RegExp(pattern, 'gi'));
                return matches ? pattern : null;
            })
            .filter(Boolean)
    );

    const minimumSectionsRequired = 2; // Reduced from 3 to be more lenient

    logger.debug('Response format validation:', {
        language,
        uniqueSectionTypes: uniqueSectionTypes.size,
        requiredMinimum: minimumSectionsRequired,
        foundSections: Array.from(uniqueSectionTypes),
        responsePreview: response.substring(0, 100)
    });

    // Basic format check - must have at least some section formatting
    const hasSectionFormatting = /\[[^\]]+\]/.test(response);
    
    return uniqueSectionTypes.size >= minimumSectionsRequired && hasSectionFormatting;
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
            language: (adventure.language as SupportedLanguage) || 'en-US',
            adventureSettings: {
                worldStyle: adventure.worldStyle as any,
                toneStyle: adventure.toneStyle as any,
                magicLevel: adventure.magicLevel as any,
                setting: adventure.setting || undefined
            },
            memory: {
                currentScene: currentScene ? {
                    description: currentScene.description,
                    summary: currentScene.summary,
                    keyEvents: currentScene.keyEvents,
                    npcInteractions: JSON.parse(currentScene.npcInteractions as string || '{}'),
                    decisions: JSON.parse(currentScene.decisions as string || '[]'),
                    questProgress: JSON.parse(currentScene.questProgress as string || '{}'),
                    locationContext: currentScene.locationContext || ''
                } : {
                    description: '',
                    summary: '',
                    keyEvents: [],
                    npcInteractions: {},
                    decisions: [],
                    questProgress: {},
                    locationContext: ''
                },
                recentScenes: [],
                significantMemories: [],
                activeQuests: [],
                knownCharacters: [],
                discoveredLocations: [],
                importantItems: []
            }
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