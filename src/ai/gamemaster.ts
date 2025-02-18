import { GameContext } from '../shared/game/types';
import { SupportedLanguage } from '../shared/i18n/types';
import { logger, prettyPrintLog } from '../shared/logger';
import { buildContextString, getGamePrompt, createFallbackResponse } from '../shared/game/prompts';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { Character } from '../features/character/types';
import { calculateVectorSimilarity, findMostSimilarScenes } from '../shared/game/vector';

interface MemoryItem {
    title: string;
    description: string;
    type?: string;
}

interface CombatParticipant {
    id: string;
    initiative: number;
    health: number;
    maxHealth: number;
    statusEffects: string[];
}

interface StoryElement {
    type: 'location' | 'character' | 'quest' | 'item' | 'plot';
    name: string;
    description: string;
}

const AI_ENDPOINT = process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate';
const AI_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

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
    const maxRetries = 3;
    let retryCount = 0;
    let lastError = null;

    while (retryCount < maxRetries) {
        try {
            const response = await attemptResponse(context, retryCount, lastError ? `Retry ${retryCount + 1}/${maxRetries}: ${lastError}` : undefined);
            return response;
        } catch (error: any) {
            lastError = error.message;
            retryCount++;
            logger.warn(`Attempt ${retryCount}/${maxRetries} failed: ${error.message}`);
            
            if (retryCount === maxRetries) {
                logger.error('All retry attempts failed');
                throw error;
            }
            
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        }
    }

    throw new Error('Failed to generate response after all retries');
}

// Add utility function for text similarity
function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
        return 1.0;
    }
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (1.0 - editDistance / longer.length);
}

function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str1.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str2.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str1.length; i++) {
        for (let j = 1; j <= str2.length; j++) {
            if (str1[i-1] === str2[j-1]) {
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i-1][j-1] + 1,
                    matrix[i][j-1] + 1,
                    matrix[i-1][j] + 1
                );
            }
        }
    }
    
    return matrix[str1.length][str2.length];
}

// Add helper function for location rotation
function getLocationRotationPrompt(context: GameContext): string {
    const recentLocations = context.memory.recentScenes
        .slice(0, 3)
        .map(s => extractLocation(s.summary))
        .filter(Boolean);

    if (recentLocations.length >= 3 && new Set(recentLocations).size === 1) {
        return '⚠️ MUST CHANGE LOCATION - Scene has been in same place too long!';
    }
    return 'Consider moving to a new area to maintain story momentum';
}

function getProgressionRequirements(context: GameContext): string {
    const sceneCount = context.memory.recentScenes.length;
    const needsNewLocation = sceneCount > 3;
    const needsQuestHook = !context.memory.activeQuests.length;
    const hasCharacters = context.memory.knownCharacters.length > 0;
    const recentLocations = context.memory.recentScenes
        .slice(0, 3)
        .map(s => extractLocation(s.summary))
        .filter(Boolean);
    const isLocationStagnant = recentLocations.length >= 3 && new Set(recentLocations).size === 1;

    return `STRICT STORY PROGRESSION REQUIREMENTS:

${needsNewLocation || isLocationStagnant ? '⚠️ LOCATION CHANGE REQUIRED - Must move to a new area!' : ''}
${needsQuestHook ? '⚠️ QUEST HOOK REQUIRED - Must introduce a new mission or objective!' : ''}

1. MUST introduce ONE of these per response:
   ${needsNewLocation ? '⚠️ NEW LOCATION REQUIRED' : '◻ New character'}
   ${needsQuestHook ? '⚠️ QUEST HOOK REQUIRED' : '◻ Plot twist'}
   ◻ Unique environmental hazard
   ◻ Mysterious artifact/object

2. Location Rotation Required:
   Previous locations: ${context.memory.discoveredLocations.map(l => l.title).join(', ') || 'None'}
   ${getLocationRotationPrompt(context)}

3. Character Development:
   Current relationships: ${(context.memory.knownCharacters || []).map(c => c.title).join(', ') || 'None'}
   Must ${hasCharacters ? 'deepen existing relationships' : 'establish new relationships'}
   Show character reactions and emotions

4. NARRATIVE TENSION:
   - Build mystery or conflict
   - Create anticipation
   - Add environmental or situational changes
   
5. ACTION CONSEQUENCES:
   - Show immediate effects of player choices
   - Change NPC attitudes or behavior
   - Modify environment or situation
   - Progress toward goals

PREVIOUS SCENES:
${context.memory.recentScenes.slice(0, 3).map(s => `- ${s.summary}`).join('\n')}

FAILURE TO MEET THESE REQUIREMENTS WILL RESULT IN RESPONSE REJECTION.`;
}

async function attemptResponse(context: GameContext, retryCount: number, retryReason?: string): Promise<string> {
    const spinner = ora({
        text: chalk.cyan('Generating AI response...\n\n'),
        spinner: 'dots12'
    });

    try {
        const language = context.language;
        const lastSceneSummary = context.memory.recentScenes[0]?.summary || '';
        
        // Enhanced scene stagnation check
        const isSceneStagnating = context.memory.recentScenes
            .slice(0, 3)
            .every(scene => 
                calculateSimilarity(scene.summary, lastSceneSummary) > 0.6
            );

        // Dynamic temperature and penalty adjustments
        const temperature = Math.min(0.9 + (retryCount * 0.15) + (isSceneStagnating ? 0.2 : 0), 1.4);
        const presencePenalty = 0.7 + (retryCount * 0.1) + (isSceneStagnating ? 0.2 : 0);
        const frequencyPenalty = 0.7 + (retryCount * 0.1) + (isSceneStagnating ? 0.2 : 0);

        // Build memory context
        const memoryContext = `
MEMORY CONTEXT:
1. Recent Scenes:
${context.memory.recentScenes.map((scene, i) => `   ${i + 1}. ${scene.summary}`).join('\n')}

2. Known Characters:
${context.memory.knownCharacters.map(char => `   - ${char.title}: ${char.description}`).join('\n')}

3. Active Quests:
${context.memory.activeQuests.map(quest => `   - ${quest.title}: ${quest.description}`).join('\n')}

4. Discovered Locations:
${context.memory.discoveredLocations.map(loc => `   - ${loc.title}: ${loc.description}`).join('\n')}

5. Important Items:
${context.memory.importantItems.map(item => `   - ${item.title}: ${item.description}`).join('\n')}

NARRATIVE PROGRESSION REQUIREMENTS:
1. DO NOT REPEAT previous scenes or actions
2. MUST ADVANCE the story with one of:
   - New location discovery
   - Character development
   - Quest progression
   - Environmental change
3. MUST SHOW CONSEQUENCES of previous actions
4. MUST MAINTAIN CONTINUITY with previous scenes
5. MUST ADD TENSION or mystery

SCENE STRUCTURE:
1. Reference relevant past events
2. Describe immediate consequences
3. Introduce new story elements
4. Create anticipation for what's next
`;

        const progressionPrompt = getProgressionRequirements(context);
        const contextStr = buildContextString(context, language);
        const prompt = getGamePrompt(language);
        
        const reinforcementPrompt = retryReason ? `
PREVIOUS RESPONSE WAS INVALID: ${retryReason}

${progressionPrompt}
${memoryContext}

IMPORTANT: You MUST respond with ONLY a valid JSON object. Your last response was rejected.
The response must match this exact structure for ${language === 'en-US' ? 'English' : 'Portuguese'}:

${language === 'en-US' ? `{
    "narration": "Vivid description of environment and results of player actions. MUST advance the story and show consequences.",
    "atmosphere": "(Optional) Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 based on character abilities and current situation",
        "Action 2 based on character abilities and current situation",
        "Action 3 based on character abilities and current situation"
    ]
}` : `{
    "narracao": "Descrição vívida do ambiente e resultados das ações do jogador. DEVE avançar a história e mostrar consequências.",
    "atmosfera": "(Opcional) Humor atual, clima e detalhes do ambiente",
    "acoes_disponiveis": [
        "Ação 1 baseada nas habilidades do personagem e situação atual",
        "Ação 2 baseada nas habilidades do personagem e situação atual",
        "Ação 3 baseada nas habilidades do personagem e situação atual"
    ]
}`}` : progressionPrompt;

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

${progressionPrompt}
${memoryContext}

CURRENT GAME CONTEXT:
${contextStr}
${reinforcementPrompt}

RESPONSE FORMAT:
You MUST respond with a valid JSON object. No other text or formatting is allowed.
The response must match this exact structure for ${language === 'en-US' ? 'English' : 'Portuguese'}:

${language === 'en-US' ? `{
    "narration": "Vivid description introducing new story elements. MUST advance plot and show consequences. DO NOT REPEAT previous scenes.",
    "atmosphere": "(Optional) Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 that leads to new discoveries or progression",
        "Action 2 that develops character relationships",
        "Action 3 that advances the current situation"
    ]
}` : `{
    "narracao": "Descrição vívida introduzindo novos elementos. DEVE avançar a história e mostrar consequências. NÃO REPITA cenas anteriores.",
    "atmosfera": "(Opcional) Humor atual, clima e detalhes do ambiente",
    "acoes_disponiveis": [
        "Ação 1 que leva a novas descobertas ou progressão",
        "Ação 2 que desenvolve relacionamentos",
        "Ação 3 que avança a situação atual"
    ]
}`}
<|im_end|>
<|im_start|>user
${context.playerActions[0]}
<|im_end|>
`,
            temperature,
            max_tokens: 32768,
            top_p: 0.95,
            repeat_penalty: 1.5,  // Increased repeat penalty
            presence_penalty: presencePenalty,
            frequency_penalty: frequencyPenalty,
            options: {
                num_ctx: 32768,
            },
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
                    if (!parsed.narration || !Array.isArray(parsed.available_actions)) {
                        const error = 'Missing required fields in JSON response';
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                    if (parsed.available_actions.length < 3 || parsed.available_actions.length > 5) {
                        const error = `Invalid number of actions: ${parsed.available_actions.length} (must be 3-5)`;
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                } else {
                    if (!parsed.narracao || !Array.isArray(parsed.acoes_disponiveis)) {
                        const error = 'Campos obrigatórios ausentes na resposta JSON';
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                    if (parsed.acoes_disponiveis.length < 3 || parsed.acoes_disponiveis.length > 5) {
                        const error = `Número inválido de ações: ${parsed.acoes_disponiveis.length} (deve ser 3-5)`;
                        logger.error(error, parsed);
                        throw new Error(error);
                    }
                }

                // Ensure atmosphere is always present, even if empty
                if (language === 'en-US') {
                    parsed.atmosphere = parsed.atmosphere || '';
                } else {
                    parsed.atmosfera = parsed.atmosfera || '';
                }

                // Validate story progression
                if (isSceneStagnating) {
                    const newScene = language === 'en-US' ? parsed.narration : parsed.narracao;
                    if (calculateSimilarity(newScene, lastSceneSummary) > 0.6) {
                        throw new Error('Scene is not progressing enough - needs more significant changes');
                    }
                }

                // Ensure new elements are introduced
                const hasNewElements = await validateNewElements(parsed, context, language);
                if (!hasNewElements) {
                    throw new Error('Response must introduce new story elements');
                }

                fullResponse = JSON.stringify(parsed);
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
    } finally {
        spinner.stop();
    }
}

interface ValidationResult {
    isValid: boolean;
    reason?: string;
    category?: 'SIMILARITY' | 'MISSING_ELEMENTS' | 'STAGNATION' | 'REPETITION' | 'INSUFFICIENT_PROGRESSION' | 'COHERENCE';
    details?: {
        similarityScore?: number;
        missingElements?: string[];
        suggestedImprovements?: string[];
    };
}

function validateResponseFormat(response: string, language: SupportedLanguage): ValidationResult {
    try {
        const parsedResponse = JSON.parse(response);
        
        // Allow both English and Portuguese field names
        const hasNarration = typeof parsedResponse.narration === 'string' || typeof parsedResponse.narracao === 'string';
        const hasAtmosphere = typeof parsedResponse.atmosphere === 'string' || typeof parsedResponse.atmosfera === 'string';
        const hasActions = Array.isArray(parsedResponse.available_actions) || Array.isArray(parsedResponse.acoes_disponiveis);
        const actions = parsedResponse.available_actions || parsedResponse.acoes_disponiveis;

        if (!hasNarration) {
            return { 
                isValid: false, 
                reason: language === 'en-US' 
                    ? 'Missing or invalid "narration/narracao" field - must be a string'
                    : 'Campo "narration/narracao" ausente ou inválido - deve ser uma string'
            };
        }

        if (!hasAtmosphere) {
            return { 
                isValid: false, 
                reason: language === 'en-US'
                    ? 'Missing or invalid "atmosphere/atmosfera" field - must be a string'
                    : 'Campo "atmosphere/atmosfera" ausente ou inválido - deve ser uma string'
            };
        }

        if (!hasActions) {
            return { 
                isValid: false, 
                reason: language === 'en-US'
                    ? 'Missing or invalid "available_actions/acoes_disponiveis" field - must be an array'
                    : 'Campo "available_actions/acoes_disponiveis" ausente ou inválido - deve ser um array'
            };
        }

        if (actions.length < 3 || actions.length > 5) {
            return { 
                isValid: false, 
                reason: language === 'en-US'
                    ? `Invalid number of actions: ${actions.length} (must be 3-5)`
                    : `Número inválido de ações: ${actions.length} (deve ser 3-5)`
            };
        }

        if (!actions.every((action: any) => typeof action === 'string')) {
            return { 
                isValid: false, 
                reason: language === 'en-US'
                    ? 'All actions must be strings'
                    : 'Todas as ações devem ser strings'
            };
        }

        // Check for extra fields, but allow both English and Portuguese field names
        const allowedFields = [
            'narration', 'narracao',
            'atmosphere', 'atmosfera',
            'available_actions', 'acoes_disponiveis'
        ];
        
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

function extractLocation(scene: string): string {
    // Extract location details from the scene
    const locations = ['penhasco', 'cratera', 'abertura', 'buraco', 'superfície'];
    return locations.filter(loc => scene.toLowerCase().includes(loc)).join(', ');
}

function extractKnownElements(context: GameContext): string {
    const characters = (context.memory.knownCharacters || []).map((char: MemoryItem) => char.title);
    const locations = (context.memory.discoveredLocations || []).map((loc: MemoryItem) => loc.title);
    const items = (context.memory.importantItems || []).map((item: MemoryItem) => item.title);
    
    return [...characters, ...locations, ...items].join(', ');
}

async function validateNewElements(
    response: any,
    context: GameContext,
    language: SupportedLanguage
): Promise<boolean> {
    const narration = language === 'en-US' ? response.narration : response.narracao;
    const lastScene = context.memory.recentScenes[0]?.summary || '';
    
    const validationResults: ValidationResult[] = [];
    const newElements: StoryElement[] = [];
    
    // Check for scene similarity and purpose using vector embeddings
    const recentScenes = context.memory.recentScenes.slice(0, 5).map(s => s.summary);
    const similarityResults = await findMostSimilarScenes(narration, recentScenes);
    
    if (!similarityResults.similarityMetrics.isValid) {
        const { purpose } = similarityResults.similarityMetrics;
        
        if (similarityResults.similarityMetrics.tooSimilar) {
            validationResults.push({
                isValid: false,
                category: 'SIMILARITY',
                reason: 'Scene is too similar to a recent scene',
                details: {
                    similarityScore: similarityResults.maxSimilarity,
                    suggestedImprovements: [
                        'Change the location significantly',
                        'Introduce unexpected events',
                        'Add meaningful consequences'
                    ]
                }
            });
        } else if (similarityResults.similarityMetrics.tooDifferent) {
            validationResults.push({
                isValid: false,
                category: 'COHERENCE',
                reason: 'Scene lacks connection to recent events',
                details: {
                    similarityScore: similarityResults.maxSimilarity,
                    suggestedImprovements: [
                        'Reference recent events',
                        'Build on established elements',
                        'Maintain story continuity'
                    ]
                }
            });
        }
        
        if (purpose.purposeScore < 0.3) {
            validationResults.push({
                isValid: false,
                category: 'INSUFFICIENT_PROGRESSION',
                reason: 'Scene lacks clear purpose or progression',
                details: {
                    missingElements: [
                        !purpose.hasProgression ? 'story progression' : '',
                        !purpose.hasConsequence ? 'meaningful consequences' : '',
                        !purpose.hasNewElement ? 'new elements' : ''
                    ].filter(Boolean),
                    suggestedImprovements: [
                        'Add clear story progression',
                        'Show consequences of actions',
                        'Introduce new story elements'
                    ]
                }
            });
        }
    }

    // More lenient location change requirement (every 4 scenes)
    const currentLocation = extractLocation(lastScene);
    const newLocation = extractLocation(narration);
    if (newLocation && newLocation !== currentLocation) {
        newElements.push({
            type: 'location',
            name: newLocation,
            description: narration
        });
    } else if (context.memory.recentScenes.length > 4) {
        validationResults.push({
            isValid: false,
            category: 'STAGNATION',
            reason: 'Location has remained unchanged for too long',
            details: {
                missingElements: ['new location'],
                suggestedImprovements: [
                    'Move to a new area',
                    'Discover hidden paths',
                    'Find alternate routes'
                ]
            }
        });
    }

    // Enhanced character detection with name validation
    const characterMatches = narration.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g) || [];
    const knownCharacters = new Set((context.memory.knownCharacters || []).map(c => c.title));
    const newChars = characterMatches.filter((name: string) =>
        !knownCharacters.has(name) &&
        !['Braum'].includes(name) &&
        name.length > 2
    );
    
    if (newChars.length > 0) {
        newElements.push({
            type: 'character',
            name: newChars[0],
            description: narration
        });
    }

    // Enhanced quest hook detection with more triggers
    const questTriggers = language === 'en-US' 
        ? ['mission', 'quest', 'task', 'help', 'danger', 'mystery', 'challenge', 'problem', 'request', 'secret', 'legend', 'rumor', 'discover', 'find', 'seek', 'investigate']
        : ['missão', 'busca', 'tarefa', 'ajuda', 'perigo', 'mistério', 'desafio', 'problema', 'pedido', 'segredo', 'lenda', 'rumor', 'descobrir', 'encontrar', 'procurar', 'investigar'];
    
    const hasQuestHook = new RegExp(questTriggers.join('|'), 'i').test(narration);
    if (hasQuestHook) {
        newElements.push({
            type: 'quest',
            name: 'New Quest Hook',
            description: narration
        });
    }

    // Success criteria: Must have valid purpose OR introduce new elements
    const hasValidPurpose = similarityResults.similarityMetrics.isValid;
    const hasNewElements = newElements.length > 0;

    // Log validation results
    logger.debug('Story progression validation:', {
        validationResults,
        newElements,
        similarityResults,
        hasValidPurpose,
        hasNewElements
    });

    return hasValidPurpose || hasNewElements;
}