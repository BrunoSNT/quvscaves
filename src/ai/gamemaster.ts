import axios from 'axios';
import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../lib/prisma';
import { speakInVoiceChannel } from '../lib/voice';
import { getMessages } from '../utils/language';
import { GameContext, GameState, Character, SupportedLanguage } from '../types/game';
import { logger } from '../utils/logger';
import { getGamePrompt, buildContextString, createFallbackResponse } from '../utils/gamePrompts';
import chalk from 'chalk';

const AI_ENDPOINT = process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate';
const AI_MODEL = 'qwen2.5:14b';

export interface AIResponse {
    response?: string;
    error?: string;
}

function formatContext(context: GameContext): string {
    return `
${chalk.cyan('Adventure Settings:')}
${chalk.gray('Style:')} ${chalk.magenta(context.adventureSettings.worldStyle)}
${chalk.gray('Tone:')} ${chalk.magenta(context.adventureSettings.toneStyle)}
${chalk.gray('Magic Level:')} ${chalk.magenta(context.adventureSettings.magicLevel)}
${context.adventureSettings.setting ? `${chalk.gray('Setting:')} ${chalk.magenta(context.adventureSettings.setting)}` : ''}

${chalk.cyan('Current Scene:')}
${chalk.gray(context.scene)}

${chalk.cyan('Characters:')}
${context.characters.map(char => `${chalk.yellow(char.name)} (${chalk.gray(char.class)} Lvl ${chalk.yellow(char.level)})
  ${chalk.gray('Stats:')} STR:${char.strength} DEX:${char.dexterity} CON:${char.constitution} INT:${char.intelligence} WIS:${char.wisdom} CHA:${char.charisma}
  ${chalk.gray('Proficiencies:')} ${char.proficiencies?.length ? char.proficiencies.join(', ') : 'None'}
  ${chalk.gray('Languages:')} ${char.languages?.length ? char.languages.join(', ') : 'None'}
  ${chalk.gray('Spells:')} ${char.spells?.length ? char.spells.map(s => s.name).join(', ') : 'None'}
  ${chalk.gray('Abilities:')} ${char.abilities?.length ? char.abilities.map(a => a.name).join(', ') : 'None'}`).join('\n')}

${chalk.cyan('Player State:')}
${chalk.red('❤️ Health:')} ${context.currentState.health}
${chalk.blue('🔮 Mana:')} ${context.currentState.mana}
${chalk.gray('🎒 Inventory:')} ${context.currentState.inventory.length ? context.currentState.inventory.join(', ') : 'Empty'}
${chalk.gray('Quest Progress:')} ${context.currentState.questProgress}

${chalk.cyan('Memory:')}
${chalk.yellow('Recent Scenes:')}
${context.memory.recentScenes.map(scene => chalk.gray(`- ${scene.summary}`)).join('\n') || chalk.gray('None')}

${chalk.yellow('Active Quests:')}
${context.memory.activeQuests.map(quest => chalk.gray(`- ${quest.title}: ${quest.description}`)).join('\n') || chalk.gray('None')}

${chalk.yellow('Known Characters:')}
${context.memory.knownCharacters.map(char => chalk.gray(`- ${char.title}: ${char.description}`)).join('\n') || chalk.gray('None')}

${chalk.yellow('Discovered Locations:')}
${context.memory.discoveredLocations.map(loc => chalk.gray(`- ${loc.title}: ${loc.description}`)).join('\n') || chalk.gray('None')}

${chalk.yellow('Important Items:')}
${context.memory.importantItems.map(item => chalk.gray(`- ${item.title}: ${item.description}`)).join('\n') || chalk.gray('None')}

${chalk.cyan('Combat Status:')} ${context.combat ? chalk.yellow('Active') : chalk.gray('None')}
${context.combat ? `Round: ${chalk.yellow(context.combat.round)}
Current Turn: ${chalk.yellow(context.combat.currentTurn)}
Participants:
${context.combat.participants.map(p => chalk.gray(`- ${p.id} (Initiative: ${p.initiative}, Health: ${p.health}/${p.maxHealth})
  Status Effects: ${p.statusEffects.join(', ') || 'None'}`)).join('\n')}` : ''}

${chalk.cyan('Recent Action:')} ${chalk.yellow(context.playerActions[0])}
${chalk.cyan('Language:')} ${chalk.magenta(context.language)}
`;
}

export async function generateResponse(context: GameContext): Promise<string> {
    try {
        const language = context.language;
        const prompt = getGamePrompt(language);
        const contextStr = buildContextString(context, language);

        logger.debug(chalk.cyan('Generating AI response...'));
        logger.debug(chalk.gray('Context:'), formatContext(context));

        logger.debug(chalk.cyan('Sending request to AI:'), {
            endpoint: AI_ENDPOINT,
            model: AI_MODEL,
            language: language
        });

        const systemPrompt = `${prompt.system}

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

        logger.debug(chalk.green('Response received:'), {
            length: aiResponse.length,
            preview: aiResponse.substring(0, 100)
        });

        // Handle tool calls in the response
        const toolCalls = aiResponse.match(/<tool_call>(.*?)<\/tool_call>/gs);
        if (toolCalls) {
            for (const toolCall of toolCalls) {
                try {
                    const toolData = JSON.parse(toolCall.replace(/<\/?tool_call>/g, ''));
                    logger.debug(chalk.cyan('Tool Call:'), {
                        name: toolData.name,
                        args: JSON.stringify(toolData.arguments)
                    });
                } catch (error) {
                    logger.error(chalk.red('Tool Call Error:'), error);
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
            logger.error(chalk.red('API Error:'), {
                status: error.response?.status,
                message: error.message,
                data: JSON.stringify(error.response?.data)
            });
        } else {
            logger.error(chalk.red('Error:'), error);
        }
        return createFallbackResponse(context);
    }
}

function validateResponseFormat(response: string, language: SupportedLanguage): boolean {
    const requiredSections = language === 'en-US' 
        ? {
            narration: ['Narration', 'Narrative'],
            atmosphere: ['Atmosphere', 'Environment'],
            actions: ['Available Actions', 'Actions', 'Suggested Actions', 'Choices'],
            memory: ['Memory', 'History']
        }
        : {
            narration: ['Narração', 'Narrativa'],
            atmosphere: ['Atmosfera', 'Ambiente'],
            actions: ['Ações Disponíveis', 'Sugestões de Ação', 'Ações', 'Escolhas'],
            memory: ['Memória', 'História']
        };
    
    // Create patterns for required sections
    const patterns = Object.entries(requiredSections).map(([type, names]) => ({
        type,
        patterns: names.map(name => `\\[${name}\\]([^\\[]*?)(?=\\[|$)`)
    }));

    // Check each section type and its content
    const foundSections = patterns.map(({ type, patterns }) => {
        // Try each possible pattern for this section type
        for (const pattern of patterns) {
            const match = response.match(new RegExp(pattern, 'i'));
            if (match) {
                // Check if section has actual content (not just whitespace)
                const content = match[1]?.trim();
                // For actions section, verify it has bullet points
                if (type === 'actions' && content) {
                    const hasChoices = content.split('\n')
                        .some(line => line.trim().startsWith('-'));
                    return { 
                        type, 
                        found: true,
                        hasContent: hasChoices,
                        content
                    };
                }
                return { 
                    type, 
                    found: true,
                    hasContent: !!content,
                    content
                };
            }
        }
        return { 
            type, 
            found: false,
            hasContent: false,
            content: null 
        };
    });

    // Log validation details with more info about actions
    logger.debug(chalk.cyan('Response Validation:'), {
        sections: foundSections.map(s => {
            const status = s.found 
                ? (s.hasContent 
                    ? '✓' 
                    : 'empty')
                : '✗';
            const extra = s.type === 'actions' && s.content 
                ? ` (${s.content.split('\n').filter(l => l.trim().startsWith('-')).length} choices)`
                : '';
            return `${s.type}: ${status}${extra}`;
        }),
        required: ['narration', 'atmosphere', 'actions'].join(', '),
        preview: response.substring(0, 100)
    });

    // Must have required sections with content
    const requiredTypes = ['narration', 'atmosphere', 'actions'];
    const hasRequiredSections = requiredTypes.every(type => {
        const section = foundSections.find(s => s.type === type);
        return section?.found && section?.hasContent;
    });

    // Don't allow empty required sections
    const hasEmptyRequiredSections = foundSections.some(s => 
        s.found && !s.hasContent && requiredTypes.includes(s.type)
    );

    // Basic format check - must have proper section formatting
    const hasSectionFormatting = /\[[^\]]+\]/.test(response);
    
    return hasRequiredSections && hasSectionFormatting && !hasEmptyRequiredSections;
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