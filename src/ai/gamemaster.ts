import axios from 'axios';
import { GameContext } from '../shared/game/types';
import { logger, prettyPrintLog } from '../shared/logger';
import { getGamePrompt, buildContextString, createFallbackResponse } from '../shared/game/prompts';
import chalk from 'chalk';
import ora from 'ora';
import util from 'util';
import { SupportedLanguage } from '../shared/i18n/types';

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

export async function generateResponse(context: GameContext): Promise<string> {
    const spinner = ora({
        text: chalk.cyan('Generating AI response...'),
        spinner: 'dots12'
    }).start();

    const maxRetries = 2;
    let retryCount = 0;

    async function attemptResponse(retryReason?: string): Promise<string> {
        const language = context.language;
        const prompt = getGamePrompt(language);
        const contextStr = buildContextString(context, language);

        const reinforcementPrompt = retryReason ? `
PREVIOUS RESPONSE WAS INVALID: ${retryReason}

YOU MUST RESPOND WITH EXACTLY THIS JSON STRUCTURE:
${language === 'en-US' ? `{
    "narration": "Vivid description of environment and results of player actions",
    "atmosphere": "Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 based on character abilities",
        "Action 2 based on character abilities",
        "Action 3 based on character abilities"
    ]
}` : `{
    "narracao": "Descrição vívida do ambiente e resultados das ações do jogador",
    "atmosfera": "Humor atual, clima e detalhes do ambiente",
    "acoes_disponiveis": [
        "Ação 1 baseada nas habilidades do personagem",
        "Ação 2 baseada nas habilidades do personagem",
        "Ação 3 baseada nas habilidades do personagem"
    ]
}`}

REQUIREMENTS:
1. MUST be valid JSON
2. MUST include all fields exactly as shown
3. NO additional fields or text
4. NO formatting markers
5. NO player prompts or questions
6. 3-5 actions only
7. Actions MUST match character abilities` : '';

        logger.debug(chalk.cyan('Sending request to AI:'), prettyPrintLog(JSON.stringify({
            endpoint: AI_ENDPOINT,
            model: AI_MODEL,
            language,
            retryCount,
            retryReason
        })));

        const response = await axios.post(AI_ENDPOINT, {
            model: AI_MODEL,
            prompt: `<|im_start|>system
${prompt.system}
${prompt.intro}

CURRENT GAME CONTEXT:
${contextStr}
${reinforcementPrompt}

RESPONSE FORMAT:
You MUST respond with a valid JSON object. No other text or formatting is allowed.
The response must match this exact structure for ${language === 'en-US' ? 'English' : 'Portuguese'}:

${language === 'en-US' ? `{
    "narration": "Vivid description of environment and results of player actions",
    "atmosphere": "Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 based on character abilities",
        "Action 2 based on character abilities",
        "Action 3 based on character abilities"
    ]
}` : `{
    "narracao": "Descrição vívida do ambiente e resultados das ações do jogador",
    "atmosfera": "Humor atual, clima e detalhes do ambiente",
    "acoes_disponiveis": [
        "Ação 1 baseada nas habilidades do personagem",
        "Ação 2 baseada nas habilidades do personagem",
        "Ação 3 baseada nas habilidades do personagem"
    ]
}`}
<|im_end|>
<|im_start|>user
${context.playerActions[0]}
<|im_end|>
<|im_start|>assistant
`,
            temperature: 0.3,
            max_tokens: 800,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["<|im_end|>"],
            stream: false
        });

        let fullResponse = '';
        if (typeof response.data === 'object' && response.data.response) {
            fullResponse = response.data.response;
        } else if (typeof response.data === 'string') {
            fullResponse = response.data;
        }

        // Clean up the response
        fullResponse = fullResponse
            .replace(/<\|im_start\|>assistant/g, '')
            .replace(/<\|im_end\|>/g, '')
            .trim();

        // Try to extract JSON from the response
        const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                // Validate the extracted JSON is parseable
                JSON.parse(jsonMatch[0]);
                fullResponse = jsonMatch[0];
            } catch {
                // If parsing fails, keep the original cleaned response
            }
        }

        return fullResponse;
    }

    try {
        let response = await attemptResponse();
        let validationError = validateResponseFormat(response, context.language);

        while (!validationError.isValid && retryCount < maxRetries) {
            retryCount++;
            logger.warn(`${chalk.yellow('⟲')} Retry ${retryCount}/${maxRetries}: ${validationError.reason}`);
            response = await attemptResponse(validationError.reason);
            validationError = validateResponseFormat(response, context.language);
        }

        if (!validationError.isValid) {
            logger.error(`${chalk.red('✖')} Failed to get valid response after ${maxRetries} retries`);
            logger.debug(`${chalk.gray('↳')} Last response: ${prettyPrintLog(response)}`);
            
            // Return fallback JSON response
            const fallbackResponse = context.language === 'en-US' ? {
                narration: "The path ahead remains unclear, but your determination drives you forward...",
                atmosphere: "A moment of uncertainty hangs in the air as you consider your next move.",
                available_actions: [
                    "Wait and observe your surroundings",
                    "Proceed with caution",
                    "Search for alternative paths"
                ]
            } : {
                narracao: "O caminho à frente permanece incerto, mas sua determinação o impulsiona adiante...",
                atmosfera: "Um momento de incerteza paira no ar enquanto você considera seu próximo movimento.",
                acoes_disponiveis: [
                    "Aguardar e observar seus arredores",
                    "Prosseguir com cautela",
                    "Procurar por caminhos alternativos"
                ]
            };
            return formatDiscordResponse(JSON.stringify(fallbackResponse, null, 2), context.language);
        }

        logger.debug(`${chalk.green('✓')} Generated response: ${prettyPrintLog(response)}`);
        return formatDiscordResponse(response, context.language);
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error(`${chalk.red('✖')} API Error:`, {
                status: error.response?.status,
                message: error.message,
                data: JSON.stringify(error.response?.data)
            });
        } else {
            logger.error(`${chalk.red('✖')} Error:`, error);
        }
        
        // Return fallback JSON response
        const fallbackResponse = context.language === 'en-US' ? {
            narration: "The path ahead remains unclear, but your determination drives you forward...",
            atmosphere: "A moment of uncertainty hangs in the air as you consider your next move.",
            available_actions: [
                "Wait and observe your surroundings",
                "Proceed with caution",
                "Search for alternative paths"
            ]
        } : {
            narracao: "O caminho à frente permanece incerto, mas sua determinação o impulsiona adiante...",
            atmosfera: "Um momento de incerteza paira no ar enquanto você considera seu próximo movimento.",
            acoes_disponiveis: [
                "Aguardar e observar seus arredores",
                "Prosseguir com cautela",
                "Procurar por caminhos alternativos"
            ]
        };
        return formatDiscordResponse(JSON.stringify(fallbackResponse, null, 2), context.language);
    } finally {
        spinner.stop();
    }
}

interface ValidationResult {
    isValid: boolean;
    reason?: string;
}

function validateResponseFormat(response: string, language: SupportedLanguage): ValidationResult {
    try {
        // Try to parse the response as JSON
        const parsedResponse = JSON.parse(response);
        
        // Check if we have all required fields based on language
        if (language === 'en-US') {
            if (typeof parsedResponse.narration !== 'string') {
                return { isValid: false, reason: 'Missing or invalid "narration" field - must be a string' };
            }
            if (typeof parsedResponse.atmosphere !== 'string') {
                return { isValid: false, reason: 'Missing or invalid "atmosphere" field - must be a string' };
            }
            if (!Array.isArray(parsedResponse.available_actions)) {
                return { isValid: false, reason: 'Missing or invalid "available_actions" field - must be an array' };
            }
            if (parsedResponse.available_actions.length < 3 || parsedResponse.available_actions.length > 5) {
                return { isValid: false, reason: `Invalid number of actions: ${parsedResponse.available_actions.length} (must be 3-5)` };
            }
            if (!parsedResponse.available_actions.every((action: any) => typeof action === 'string')) {
                return { isValid: false, reason: 'All actions must be strings' };
            }
        } else {
            if (typeof parsedResponse.narracao !== 'string') {
                return { isValid: false, reason: 'Campo "narracao" ausente ou inválido - deve ser uma string' };
            }
            if (typeof parsedResponse.atmosfera !== 'string') {
                return { isValid: false, reason: 'Campo "atmosfera" ausente ou inválido - deve ser uma string' };
            }
            if (!Array.isArray(parsedResponse.acoes_disponiveis)) {
                return { isValid: false, reason: 'Campo "acoes_disponiveis" ausente ou inválido - deve ser um array' };
            }
            if (parsedResponse.acoes_disponiveis.length < 3 || parsedResponse.acoes_disponiveis.length > 5) {
                return { isValid: false, reason: `Número inválido de ações: ${parsedResponse.acoes_disponiveis.length} (deve ser 3-5)` };
            }
            if (!parsedResponse.acoes_disponiveis.every((action: any) => typeof action === 'string')) {
                return { isValid: false, reason: 'Todas as ações devem ser strings' };
            }
        }

        // Check for extra fields
        const allowedFields = language === 'en-US' 
            ? ['narration', 'atmosphere', 'available_actions']
            : ['narracao', 'atmosfera', 'acoes_disponiveis'];
        
        const extraFields = Object.keys(parsedResponse).filter(key => !allowedFields.includes(key));
        if (extraFields.length > 0) {
            return { 
                isValid: false, 
                reason: language === 'en-US'
                    ? `Extra fields not allowed: ${extraFields.join(', ')}`
                    : `Campos extras não permitidos: ${extraFields.join(', ')}`
            };
        }

        return { isValid: true };
    } catch (error) {
        return { 
            isValid: false, 
            reason: language === 'en-US'
                ? 'Failed to parse response as valid JSON'
                : 'Falha ao analisar resposta como JSON válido'
        };
    }
}

interface GameOutput {
    narration?: string;
    atmosphere?: string;
    available_actions?: string[];
    narracao?: string;
    atmosfera?: string;
    acoes_disponiveis?: string[];
}

function formatDiscordResponse(response: string, language: SupportedLanguage): string {
    try {
        const gameOutput = JSON.parse(response) as GameOutput;
        const isEnglish = language === 'en-US';

        // Format sections
        const narration = isEnglish ? gameOutput.narration : gameOutput.narracao;
        const atmosphere = isEnglish ? gameOutput.atmosphere : gameOutput.atmosfera;
        const actions = isEnglish ? gameOutput.available_actions : gameOutput.acoes_disponiveis;

        // Build formatted output using Discord markdown
        const sections = [
            narration ? `📖 **${isEnglish ? 'Narration' : 'Narração'}**\n${narration}\n` : '',
            atmosphere ? `🌍 **${isEnglish ? 'Atmosphere' : 'Atmosfera'}**\n${atmosphere}\n` : '',
            actions?.length ? `⚔️ **${isEnglish ? 'Available Actions' : 'Ações Disponíveis'}**\n${actions.map(a => `• ${a}`).join('\n')}` : ''
        ].filter(Boolean);

        return sections.join('\n');
    } catch {
        return response;
    }
}