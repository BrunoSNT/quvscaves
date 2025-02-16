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
        text: chalk.cyan('Generating AI response...\n\n'),
        spinner: 'dots12'
    });

    const maxRetries = 2;
    let retryCount = 0;

    async function attemptResponse(retryReason?: string): Promise<string> {
        const language = context.language;

        const contextStr = buildContextString(context, language);
        const prompt = getGamePrompt(language);
        const reinforcementPrompt = retryReason ? `
PREVIOUS RESPONSE WAS INVALID: ${retryReason}

IMPORTANT: You MUST respond with ONLY a valid JSON object. Your last response was rejected.
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

REQUIREMENTS:
1. MUST be valid JSON - NO markdown, NO formatting, ONLY JSON
2. MUST include all fields exactly as shown
3. NO additional fields or text outside the JSON
4. NO formatting markers or special characters
5. NO player prompts or questions
6. 3-5 actions only
7. Actions MUST match character abilities
8. Response MUST be parseable as JSON` : '';

        logger.debug('Sending request to AI:\n' + prettyPrintLog(JSON.stringify({
            endpoint: AI_ENDPOINT,
            model: AI_MODEL,
            language,
            retryCount,
            retryReason,
            contextLength: JSON.stringify(context).length,
            hasReinforcement: !!retryReason,
            prompt: {
                system: prompt.system,
                intro: prompt.intro,
                contextSentToAI: contextStr,
                contextFull: prettyPrintLog(JSON.stringify(context)),
                reinforcementPreview: reinforcementPrompt ? prettyPrintLog(JSON.stringify(reinforcementPrompt)) : 'none',
            }
        })));
        

        logger.debug('Formatted context sent to AI:\n' + formatContext(context) + '\n');

        // Initiate the axios post request
        const axiosPromise = axios.post(AI_ENDPOINT, {
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
`,
            temperature: 0.3,
            max_tokens: 800,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["<|im_end|>"],
            stream: false
        });

        // Start the spinner after the axios post call has been initiated
        spinner.start();

        const response = await axiosPromise;

        let fullResponse = '';
        if (typeof response.data === 'object' && response.data.response) {
            fullResponse = response.data.response;
        } else if (typeof response.data === 'string') {
            fullResponse = response.data;
        }

        logger.debug('Raw AI response:\n' + prettyPrintLog(JSON.stringify({
            responseLength: fullResponse.length,
            response: fullResponse,
            isObject: typeof response.data === 'object',
            hasResponseField: typeof response.data === 'object' && 'response' in response.data
        })));

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
                const parsed = JSON.parse(jsonMatch[0]);

                // Additional validation to ensure all required fields are present
                if (language === 'en-US') {
                    if (!parsed.narration || !parsed.atmosphere || !Array.isArray(parsed.available_actions)) {
                        const error = 'Missing required fields in JSON response';
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                } else {
                    if (!parsed.narracao || !parsed.atmosfera || !Array.isArray(parsed.acoes_disponiveis)) {
                        const error = 'Campos obrigatórios ausentes na resposta JSON';
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                }
                fullResponse = jsonMatch[0];
            } catch (parseError: any) {
                logger.error('Failed to parse or validate JSON response:\n' + prettyPrintLog(JSON.stringify({
                    error: parseError.message,
                    response: fullResponse,
                    jsonMatch: jsonMatch[0]
                })));
                throw new Error(`Invalid JSON response from AI: ${parseError.message}`);
            }
        } else {
            logger.error('No JSON found in response:\n' + prettyPrintLog(JSON.stringify({
                responseLength: fullResponse.length,
                responsePreview: fullResponse.substring(0, 100)
            })));
            throw new Error('No JSON found in AI response');
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
            logger.error(`${chalk.red('✖')} Failed to get valid response after ${maxRetries} retries\n` + prettyPrintLog(JSON.stringify({
                lastResponse: response,
                lastError: validationError.reason
            })));
            
            // Return fallback JSON response
            const fallbackResponse = createFallbackResponse(context);
            logger.info('Using fallback response:', fallbackResponse);
            return fallbackResponse;
        }
        logger.debug(`${chalk.green('✓')} Generated response:\n\n ${prettyPrintLog(response)}\n\n`);
        return response;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error(`${chalk.red('✖')} API Error:\n` + prettyPrintLog(JSON.stringify({
                status: error.response?.status,
                message: error.message,
                data: JSON.stringify(error.response?.data)
            })));
        } else {
            logger.error(`${chalk.red('✖')} Error:`, error);
        }
        
        // Return fallback JSON response
        const fallbackResponse = createFallbackResponse(context);
        logger.info('Using fallback response:', fallbackResponse);
        return fallbackResponse;
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