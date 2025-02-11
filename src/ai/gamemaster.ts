import axios from 'axios';
import { GameContext, SupportedLanguage } from '../types/game';
import { logger } from '../utils/logger';
import { getGamePrompt, buildContextString, createFallbackResponse } from '../utils/gamePrompts';
import chalk from 'chalk';
import ora from 'ora';
import util from 'util';

const AI_ENDPOINT = process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate';
const AI_MODEL = 'qwen2.5:3b';

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

export async function* generateResponseStream(context: GameContext): AsyncGenerator<string> {
    try {
        const language = context.language;
        const prompt = getGamePrompt(language);
        const contextStr = buildContextString(context, language);

        logger.debug(chalk.cyan('Context:'), formatContext(context));
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

        const response = await axios.post(AI_ENDPOINT, {
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
            stream: true
        }, {
            responseType: 'stream'
        });

        let currentChunk = '';
        
        for await (const chunk of response.data) {
            const text = chunk.toString();
            try {
                const lines = text.split('\n').filter(Boolean);
                for (const line of lines) {
                    const json = JSON.parse(line);
                    if (json.response) {
                        currentChunk += json.response;
                        // Yield when we have a complete sentence or significant chunk
                        if (json.response.match(/[.!?]\s*$/)) {
                            yield currentChunk;
                            currentChunk = '';
                        }
                    }
                }
            } catch (e) {
                logger.error('Error parsing chunk:', e);
            }
        }

        // Yield any remaining text
        if (currentChunk) {
            yield currentChunk;
        }

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
        yield createFallbackResponse(context);
    }
}

// Keep the old function for compatibility, but make it use the stream
export async function generateResponse(context: GameContext): Promise<string> {
    const spinner = ora({
        text: chalk.cyan('Generating AI response...'),
        spinner: 'dots12'
    }).start();

    try {
        let fullResponse = '';
        for await (const chunk of generateResponseStream(context)) {
            fullResponse += chunk;
        }

        if (!validateResponseFormat(fullResponse, context.language)) {
            logger.error('Invalid AI response format:', fullResponse);
            return createFallbackResponse(context);
        }

        return fullResponse;
    } finally {
        spinner.stop();
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
    const debugObj = {
        sections: foundSections.map((s) => {
            const status = s.found ? (s.hasContent ? '✓' : 'empty') : '✗';
            const extra =
                s.type === 'actions' && s.content
                    ? ` (${s.content.split('\n').filter((l) => l.trim().startsWith('-')).length} choices)`
                    : '';
            return `${s.type}: ${status}${extra}`;
        }),
        required: ['narration', 'atmosphere', 'actions'].join(', '),
        response: response
    };
    // Option 2: Using Node's util.inspect for possibly better formatting with colors
    logger.debug(
        `Response Validation:\n${util.inspect(debugObj, { depth: null, colors: true, compact: false })}`
    );

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