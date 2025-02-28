import { GameContext } from '../shared/game/types';
import { SupportedLanguage } from '../shared/i18n/types';
import { logger, prettyPrintLog, formatGenericOutput } from '../shared/logger';
import { buildContextString, getGamePrompt, createFallbackResponse } from '../shared/game/prompts';
import { Orchestrator } from './orchestrator';
import { config } from '../core/config';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { VectorStore } from '../core/vector/store';
import { calculateSimilarity } from '../shared/game/calculations';
import { CombatDetectionResult, CombatState, GameReward } from '../shared/game/types';
import { SkillCheck  } from '../shared/game/skills';
import { SkillCheckAnalyzer } from './skillcheck';
import { RewardAnalyzer } from './reward';
import { QwenClient } from './qwen';

export interface AIResponse {
    response?: string;
    error?: string;
}

export class GameMaster {
    private orchestrator: Orchestrator;
    private maxRetries: number = 3;
    private skillCheckAnalyzer: SkillCheckAnalyzer;
    private rewardAnalyzer: RewardAnalyzer;
    private llm: QwenClient;

    constructor(adventureId: string) {
        this.orchestrator = new Orchestrator(adventureId);
        this.skillCheckAnalyzer = SkillCheckAnalyzer.getInstance(adventureId);
        this.rewardAnalyzer = RewardAnalyzer.getInstance(adventureId);
        this.llm = new QwenClient(adventureId);
    }

    public async determineSkillCheck(action: string, context: GameContext): Promise<SkillCheck | null> {
        try {
            logger.debug('Analyzing action for skill check: ' + formatGenericOutput(JSON.stringify({
                action,
                context: context.additionalContext
            })));

            const skillCheck = await this.skillCheckAnalyzer.analyze(action, context);
            
            if (skillCheck) {
                logger.info('Determined skill check: ' + formatGenericOutput(JSON.stringify({
                    skill: skillCheck.skill,
                    difficulty: skillCheck.difficulty,
                    advantage: skillCheck.advantage,
                    disadvantage: skillCheck.disadvantage
                })));
            } else {
                logger.debug('No skill check required for action');
            }

            return skillCheck;
        } catch (error) {
            logger.error('Error determining skill check:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }

    async generateResponse(context: GameContext, customPrompt?: string): Promise<string> {
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount < this.maxRetries) {
            try {
                logger.info(`Attempt ${retryCount + 1} of ${this.maxRetries} to generate response`);
                const response = await this.attemptResponse(context, retryCount, customPrompt);
                if (response) {
                    // The response has already been validated in attemptResponse
                        logger.info('Successfully generated valid response');
                        return response;
                }
                retryCount++;
            } catch (error) {
                lastError = error as Error;
                logger.error(`Error generating response (attempt ${retryCount + 1}):` + formatGenericOutput(JSON.stringify(error)));
                retryCount++;
            }
        }

        // If all retries failed, return a fallback response
        logger.error('All response generation attempts failed: ' + formatGenericOutput(JSON.stringify(lastError)));
        return createFallbackResponse(context.language);
    }

    private async attemptResponse(context: GameContext, retryCount: number, customPrompt?: string): Promise<string> {
        const spinner = ora({
            text: chalk.cyan('Generating AI response...\n\n'),
            spinner: 'dots12'
        });

        try {
            // Get enhanced context from orchestrator
            const enhancedContext = await this.orchestrator.getEnhancedContext(context).catch(error => {
                logger.warn('Error getting enhanced context:' + formatGenericOutput(JSON.stringify(error)));
                return context; // Fallback to original context
            });
            
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

            const basePrompt = getGamePrompt(language as SupportedLanguage);
            const systemPrompt = customPrompt || basePrompt.system;
            const introPrompt = customPrompt ? '' : basePrompt.intro;

            const contextStr = buildContextString(enhancedContext, language as SupportedLanguage);

            // Construct the full prompt
            const fullPrompt = `<|im_start|>system
${systemPrompt}
${introPrompt}

CURRENT GAME CONTEXT:
${contextStr}

ADDITIONAL CONTEXT:
${enhancedContext.additionalContext?.join('\n')}

REASONING HISTORY:
${enhancedContext.reasoning?.join('\n')}
<|im_end|>
<|im_start|>user
${context.playerActions[0]}
<|im_end|>`;

            // Log the raw input being sent to the AI
            logger.debug('Raw AI Input:\n' + prettyPrintLog(JSON.stringify({
                playerAction: context.playerActions[0],
                language,
                temperature,
                presencePenalty,
                frequencyPenalty,
                isSceneStagnating,
                retryCount
            })) + "\n\n" + fullPrompt + "\n\n");

            spinner.start();
            
            const response = await axios.post(`${config.vector.ollamaUrl}/api/generate`, {
                model: config.vector.ollamaModel,
                prompt: fullPrompt,
                temperature,
                max_tokens: 32768,
                top_p: 0.95,
                repeat_penalty: 1.5,
                presence_penalty: presencePenalty,
                frequency_penalty: frequencyPenalty,
                stop: ["<|im_end|>"],
                stream: false
            });

            // Log the raw response content before any processing
            logger.info('Raw AI Response Content:' + formatGenericOutput(response.data.response));

            let responseContent: any;
            
            try {
                // Extract the response content
                if (typeof response.data === 'object' && response.data.response) {
                    // Try to find a valid JSON object in the response
                    try {
                        // First try direct parsing if it's already valid JSON
                        try {
                            responseContent = JSON.parse(response.data.response);
                            logger.debug('Successfully parsed response as JSON directly');
                        } catch (directParseError) {
                            // If direct parsing fails, try to extract JSON using regex
                    const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                                logger.debug('Found JSON in response using regex');
                        responseContent = JSON.parse(jsonMatch[0]);
                                logger.debug('Parsed JSON content successfully');
                            } else {
                                // If no JSON object found, try to fix common issues
                                let fixedJson = response.data.response.trim();
                                
                                // Check if it starts with a property instead of an object
                                if (fixedJson.startsWith('"') && fixedJson.includes(':')) {
                                    logger.debug('Response starts with a property, adding opening brace');
                                    fixedJson = '{' + fixedJson;
                                }
                                
                                // Check if it's missing the closing brace
                                if (!fixedJson.endsWith('}')) {
                                    logger.debug('Response is missing closing brace, adding it');
                                    fixedJson = fixedJson + '}';
                                }
                                
                                // Try parsing the fixed JSON
                                try {
                                    responseContent = JSON.parse(fixedJson);
                                    logger.debug('Parsed fixed JSON content successfully');
                                } catch (fixedParseError) {
                                    // Try a more aggressive approach - extract all key-value pairs
                                    logger.debug('Attempting more aggressive JSON reconstruction');
                                    try {
                                        // Extract all key-value pairs using regex
                                        const keyValuePattern = /"([^"]+)":\s*("[^"]*"|(\[[^\]]*\])|([^,}]*))/g;
                                        let match;
                                        const extractedPairs: Record<string, any> = {};
                                        let validPairsFound = false;
                                        
                                        while ((match = keyValuePattern.exec(response.data.response)) !== null) {
                                            const key = match[1];
                                            let value: any = match[2];
                                            
                                            // Clean up the value if needed
                                            if (value.startsWith('"') && value.endsWith('"')) {
                                                // It's a string, keep as is
                                            } else if (value.startsWith('[') && value.endsWith(']')) {
                                                // It's an array, keep as is
                                            } else {
                                                // Try to parse as number or boolean, or treat as string
                                                if (value === 'true') value = true;
                                                else if (value === 'false') value = false;
                                                else if (!isNaN(Number(value))) value = Number(value);
                                                else value = value.trim();
                                            }
                                            
                                            extractedPairs[key] = value;
                                            validPairsFound = true;
                                        }
                                        
                                        if (validPairsFound) {
                                            responseContent = extractedPairs;
                                            logger.debug('Successfully reconstructed JSON from key-value pairs');
                                        } else {
                                            throw new Error('No valid key-value pairs found');
                                        }
                                    } catch (reconstructError) {
                                        // Last resort: try to create a structured response from text
                                        logger.debug('Attempting to create structured response from text');
                                        try {
                                            const text = response.data.response;
                                            const language = context.language as SupportedLanguage;
                                            
                                            // Create a structured response based on the text content
                                            const structuredResponse: Record<string, any> = {};
                                            
                                            // Extract sections based on common patterns
                                            const worldContextPattern = language === 'en-US' 
                                                ? /world[_\s]?context:?\s*([\s\S]*?)(?=narration:|atmosphere:|available[_\s]?actions:|$)/i
                                                : /contexto[_\s]?mundo:?\s*([\s\S]*?)(?=narracao:|atmosfera:|acoes[_\s]?disponiveis:|$)/i;
                                            
                                            const narrationPattern = language === 'en-US'
                                                ? /narration:?\s*([\s\S]*?)(?=atmosphere:|available[_\s]?actions:|world[_\s]?context:|$)/i
                                                : /narracao:?\s*([\s\S]*?)(?=atmosfera:|acoes[_\s]?disponiveis:|contexto[_\s]?mundo:|$)/i;
                                            
                                            const atmospherePattern = language === 'en-US'
                                                ? /atmosphere:?\s*([\s\S]*?)(?=available[_\s]?actions:|world[_\s]?context:|narration:|$)/i
                                                : /atmosfera:?\s*([\s\S]*?)(?=acoes[_\s]?disponiveis:|contexto[_\s]?mundo:|narracao:|$)/i;
                                            
                                            const actionsPattern = language === 'en-US'
                                                ? /available[_\s]?actions:?\s*([\s\S]*?)(?=world[_\s]?context:|narration:|atmosphere:|$)/i
                                                : /acoes[_\s]?disponiveis:?\s*([\s\S]*?)(?=contexto[_\s]?mundo:|narracao:|atmosfera:|$)/i;
                                            
                                            // Extract and clean up each section
                                            const worldContextMatch = text.match(worldContextPattern);
                                            if (worldContextMatch && worldContextMatch[1]) {
                                                structuredResponse[language === 'en-US' ? 'world_context' : 'contexto_mundo'] = 
                                                    worldContextMatch[1].trim();
                                            }
                                            
                                            // Split text into paragraphs for potential use
                                            const textLines = text.split('\n\n').filter((line: string) => line.trim().length > 0);
                                            
                                            const narrationMatch = text.match(narrationPattern);
                                            if (narrationMatch && narrationMatch[1]) {
                                                structuredResponse[language === 'en-US' ? 'narration' : 'narracao'] = 
                                                    narrationMatch[1].trim();
                                            } else if (textLines.length > 0) {
                                                // Use the first paragraph as narration if no specific section found
                                                structuredResponse[language === 'en-US' ? 'narration' : 'narracao'] = textLines[0].trim();
                                            }
                                            
                                            const atmosphereMatch = text.match(atmospherePattern);
                                            if (atmosphereMatch && atmosphereMatch[1]) {
                                                structuredResponse[language === 'en-US' ? 'atmosphere' : 'atmosfera'] = 
                                                    atmosphereMatch[1].trim();
                                            } else if (textLines.length > 1) {
                                                // Use the second paragraph as atmosphere if no specific section found
                                                structuredResponse[language === 'en-US' ? 'atmosphere' : 'atmosfera'] = textLines[1].trim();
                                            }
                                            
                                            // Extract actions as an array
                                            const actionsMatch = text.match(actionsPattern);
                                            if (actionsMatch && actionsMatch[1]) {
                                                const actionsText = actionsMatch[1].trim();
                                                const actionsList = actionsText
                                                    .split(/\n|•|-|\d+\./)
                                                    .map((action: string) => action.trim())
                                                    .filter((action: string) => action.length > 0);
                                                
                                                structuredResponse[language === 'en-US' ? 'available_actions' : 'acoes_disponiveis'] = 
                                                    actionsList.length > 0 ? actionsList : [
                                                        language === 'en-US' ? "Explore the surroundings" : "Explorar os arredores",
                                                        language === 'en-US' ? "Talk to nearby characters" : "Conversar com personagens próximos",
                                                        language === 'en-US' ? "Search for clues" : "Procurar por pistas",
                                                        language === 'en-US' ? "Check your inventory" : "Verificar seu inventário",
                                                        language === 'en-US' ? "Rest and recover" : "Descansar e recuperar"
                                                    ];
                                            } else {
                                                // Look for numbered or bulleted lists in the text
                                                const actionLines = text.split('\n').filter((line: string) => 
                                                    /^\d+\.|\-|\•/.test(line.trim())
                                                );
                                                
                                                if (actionLines.length >= 3) {
                                                    const extractedActions = actionLines
                                                        .map((line: string) => line.replace(/^\d+\.|\-|\•/, '').trim())
                                                        .filter((action: string) => action.length > 0);
                                                    
                                                    structuredResponse[language === 'en-US' ? 'available_actions' : 'acoes_disponiveis'] = extractedActions;
                                                } else {
                                                    // Default actions if none found
                                                    structuredResponse[language === 'en-US' ? 'available_actions' : 'acoes_disponiveis'] = [
                                                        language === 'en-US' ? "Explore the surroundings" : "Explorar os arredores",
                                                        language === 'en-US' ? "Talk to nearby characters" : "Conversar com personagens próximos",
                                                        language === 'en-US' ? "Search for clues" : "Procurar por pistas",
                                                        language === 'en-US' ? "Check your inventory" : "Verificar seu inventário",
                                                        language === 'en-US' ? "Rest and recover" : "Descansar e recuperar"
                                                    ];
                                                }
                                            }
                                            
                                            // If we have at least some content, use the structured response
                                            if (Object.keys(structuredResponse).length >= 2) {
                                                responseContent = structuredResponse;
                                                logger.debug('Created structured response from text content');
                    } else {
                                                throw new Error('Could not extract sufficient content from text');
                                            }
                                            
                                        } catch (textParseError) {
                                            logger.error('No valid JSON found in response after all attempts:' + formatGenericOutput(JSON.stringify(response.data.response)));
                        throw new Error('No valid JSON found in response');
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error extracting JSON from response:' + formatGenericOutput(JSON.stringify(error)));
                        throw new Error('Failed to extract valid JSON from response');
                    }
                } else if (typeof response.data === 'string') {
                    // Apply the same logic for string responses
                    try {
                        // First try direct parsing if it's already valid JSON
                        try {
                            responseContent = JSON.parse(response.data);
                            logger.debug('Successfully parsed string response as JSON directly');
                        } catch (directParseError) {
                            // If direct parsing fails, try to extract JSON using regex
                    const jsonMatch = response.data.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                                logger.debug('Found JSON in string response using regex');
                        responseContent = JSON.parse(jsonMatch[0]);
                                logger.debug('Parsed JSON content from string successfully');
                    } else {
                                // If no JSON object found, try to fix common issues
                                let fixedJson = response.data.trim();
                                
                                // Check if it starts with a property instead of an object
                                if (fixedJson.startsWith('"') && fixedJson.includes(':')) {
                                    logger.debug('String response starts with a property, adding opening brace');
                                    fixedJson = '{' + fixedJson;
                                }
                                
                                // Check if it's missing the closing brace
                                if (!fixedJson.endsWith('}')) {
                                    logger.debug('String response is missing closing brace, adding it');
                                    fixedJson = fixedJson + '}';
                                }
                                
                                // Try parsing the fixed JSON
                                try {
                                    responseContent = JSON.parse(fixedJson);
                                    logger.debug('Parsed fixed JSON content from string successfully');
                                } catch (fixedParseError) {
                                    // Apply the same aggressive approaches as above
                                    // This is duplicated code, but keeping it separate for clarity
                                    logger.error('No valid JSON found in string response after fixing attempts:' + formatGenericOutput(JSON.stringify(response.data)));
                        throw new Error('No valid JSON found in response');
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error extracting JSON from string response:' + formatGenericOutput(JSON.stringify(error)));
                        throw new Error('Failed to extract valid JSON from response');
                    }
                } else {
                    // Handle case where response.data is neither object nor string
                    logger.error('Unexpected response format:' + formatGenericOutput(JSON.stringify(response.data)));
                    throw new Error('Unexpected response format');
                }

                // Validate response structure
                if (!this.isValidResponse(responseContent, language as SupportedLanguage)) {
                    logger.error('Invalid response structure: ' + formatGenericOutput(JSON.stringify(responseContent)));
                    throw new Error('Invalid response structure');
                }

                // Only process input and store response after validation
                try {
                    await this.orchestrator.processInput(context.playerActions[0], context);
                } catch (error) {
                    logger.warn('Error storing input memory:' + formatGenericOutput(JSON.stringify(error)));
                    // Continue even if memory storage fails
                }

                try {
                    await this.orchestrator.storeResponse(JSON.stringify(responseContent), context);
                } catch (error) {
                    logger.warn('Error storing response memory:' + formatGenericOutput(JSON.stringify(error)));
                    // Continue even if memory storage fails
                }

                spinner.stop();
                return JSON.stringify(responseContent);
            } catch (error) {
                spinner.stop();
                throw error;
            }
        } catch (error) {
            spinner.stop();
            throw error;
        }
    }

    private isValidResponse(response: any, language: SupportedLanguage): boolean {
        if (!response || typeof response !== 'object') {
            logger.error('Response is null or not an object');
            return false;
        }

        // Determine if this is an action response or world generation response
        const hasWorldContext = (language === 'en-US' && response.world_context) || 
                              (language === 'pt-BR' && response.contexto_mundo);
        
        const hasNarration = (language === 'en-US' && response.narration) || 
                           (language === 'pt-BR' && response.narracao);
        
        const hasActions = (language === 'en-US' && response.available_actions) || 
                         (language === 'pt-BR' && response.acoes_disponiveis);
        
        // For action responses, we only need narration and actions
        if (!hasWorldContext && hasNarration && hasActions) {
            // Validate narration
            const narrationField = language === 'en-US' ? 'narration' : 'narracao';
            const text = response[narrationField];
            if (typeof text !== 'string' || text.trim().length === 0) {
                logger.error(`Empty or invalid text for ${narrationField}`);
                return false;
            }
            
            // Validate actions
            const actionsField = language === 'en-US' ? 'available_actions' : 'acoes_disponiveis';
            if (!Array.isArray(response[actionsField]) || response[actionsField].length === 0) {
                logger.error(`Invalid or empty array for ${actionsField}`);
                return false;
            }

            // Log content for debugging
            logger.debug(`Content for ${narrationField}: ${text.substring(0, 100)}...`);
            logger.debug(`Actions for ${actionsField}: ${formatGenericOutput(JSON.stringify(response[actionsField]))}`);
            
            // Process narration field
            response[narrationField] = this.splitIntoChunks(response[narrationField]);
            
            // Process atmosphere field if it exists
            const atmosphereField = language === 'en-US' ? 'atmosphere' : 'atmosfera';
            if (response[atmosphereField] && typeof response[atmosphereField] === 'string') {
                response[atmosphereField] = this.splitIntoChunks(response[atmosphereField]);
            }
            
            return true;
        }
        
        // For world generation, we need world context, narration, and actions
        if (hasWorldContext && hasNarration && hasActions) {
            // Validate world context
            const worldContextField = language === 'en-US' ? 'world_context' : 'contexto_mundo';
            const worldText = response[worldContextField];
            if (typeof worldText !== 'string' || worldText.trim().length === 0) {
                logger.error(`Empty or invalid text for ${worldContextField}`);
                    return false;
                }

                // Check for placeholder text in Portuguese
                if (language === 'pt-BR') {
                if (worldText === 'Visão detalhada da história e estado atual do mundo') {
                        logger.error('Placeholder text detected for world context');
                        return false;
                    }
            }
            
            // Validate narration
            const narrationField = language === 'en-US' ? 'narration' : 'narracao';
            const narrationText = response[narrationField];
            if (typeof narrationText !== 'string' || narrationText.trim().length === 0) {
                logger.error(`Empty or invalid text for ${narrationField}`);
                return false;
            }
            
            // Check for placeholder text in Portuguese
            if (language === 'pt-BR') {
                if (narrationText === 'Descrição vívida dos arredores imediatos e da situação em um contexto de mundo amplo para que possamos entender a narrativa inicial') {
                        logger.error('Placeholder text detected for narration');
                        return false;
                    }
                }

            // Validate actions
            const actionsField = language === 'en-US' ? 'available_actions' : 'acoes_disponiveis';
            if (!Array.isArray(response[actionsField]) || response[actionsField].length === 0) {
                logger.error(`Invalid or empty array for ${actionsField}`);
                    return false;
            }
            
            // Log content for debugging
            logger.debug(`Content for ${worldContextField}: ${worldText.substring(0, 100)}...`);
            logger.debug(`Content for ${narrationField}: ${narrationText.substring(0, 100)}...`);
            logger.debug(`Actions for ${actionsField}: ${formatGenericOutput(JSON.stringify(response[actionsField]))}`);
            
            // Process text fields
            response[worldContextField] = this.splitIntoChunks(response[worldContextField]);
            response[narrationField] = this.splitIntoChunks(response[narrationField]);
            
            // Process atmosphere field if it exists
        const atmosphereField = language === 'en-US' ? 'atmosphere' : 'atmosfera';
            if (response[atmosphereField] && typeof response[atmosphereField] === 'string') {
                response[atmosphereField] = this.splitIntoChunks(response[atmosphereField]);
            }

        return true;
        }
        
        // If we get here, the response doesn't match either format
        logger.error('Response does not match any valid format');
        return false;
    }

    private splitIntoChunks(text: string): string {
        // Don't split the text, return it as is
        return text.trim();
    }

    private formatResponse(response: any, language: SupportedLanguage): string {
        const narrationField = language === 'en-US' ? 'narration' : 'narracao';
        const atmosphereField = language === 'en-US' ? 'atmosphere' : 'atmosfera';
        const actionsField = language === 'en-US' ? 'available_actions' : 'acoes_disponiveis';
        const worldContextField = language === 'en-US' ? 'world_context' : 'contexto_mundo';
        const worldContextTitle = language === 'en-US' ? 'World Context' : 'Contexto do Mundo';

        return `${worldContextTitle}:\n${response[worldContextField]}\n\n${
            response[narrationField]}\n\n${
            response[atmosphereField] ? `${language === 'en-US' ? 'Atmosphere' : 'Atmosfera'}: ${response[atmosphereField]}\n\n` : ''
        }${language === 'en-US' ? 'Available Actions' : 'Ações Disponíveis'}:\n${
            response[actionsField].map((action: string) => `• ${action}`).join('\n')
        }`;
    }

    async syncKnowledge(): Promise<void> {
        await this.orchestrator.syncKnowledge();
    }

    clearWorkingMemory(): void {
        this.orchestrator.clearWorkingMemory();
    }

    public async detectCombatIntent(action: string, context: GameContext): Promise<CombatDetectionResult> {
        // Use vector embeddings to detect combat intent
        const combatEmbeddings = await VectorStore.getInstance().compareWithConcepts(action, ['combat', 'attack', 'fight', 'aggressive']);
        const isCombatIntent = combatEmbeddings.similarity > 0.75;

        if (isCombatIntent) {
            // Identify potential participants
            const participants = context.characters.map(char => char.id);
            
            return {
                isCombat: true,
                participants,
                triggerAction: action
            };
        }

        return { isCombat: false };
    }

    public async initializeCombat(context: GameContext, combatDetails: CombatDetectionResult): Promise<CombatState> {
        // Roll initiative for all participants
        const participants = combatDetails.participants?.map(id => {
            const character = context.characters.find(c => c.id === id);
            const initiative = Math.floor(Math.random() * 20) + 1 + (character?.stats?.dexterity || 0);
            return {
                id,
                initiative,
                health: character?.health || 0,
                maxHealth: character?.maxHealth || 0,
                statusEffects: []
            };
        }) || [];

        // Sort by initiative
        participants.sort((a, b) => b.initiative - a.initiative);

        const combatState: CombatState = {
            status: 'ACTIVE',
            round: 1,
            currentTurn: participants[0]?.id || '',
            turnOrder: participants.map(p => p.id),
            participants,
            availableActions: [],
            roundHistory: []
        };

        return combatState;
    }

    private formatDebugInfo(context: GameContext): string {
        return `${chalk.cyan('Debug Info:')}
    
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

    async determineRewards(action: string, context: GameContext): Promise<GameReward[] | null> {
        try {
            logger.debug('Analyzing action for rewards: ' + formatGenericOutput(JSON.stringify({
                action,
                context: context.additionalContext
            })));

            const rewards = await this.rewardAnalyzer.analyze(action, context);
            
            if (rewards?.length) {
                logger.info('Determined rewards: ' + formatGenericOutput(JSON.stringify({
                    count: rewards.length,
                    types: rewards.map(r => r.type)
                })));
            } else {
                logger.debug('No rewards determined for action');
            }

            return rewards;
        } catch (error) {
            logger.error('Error determining rewards:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }
}

function formatContext(context: GameContext): string {
    return `
${chalk.cyan('Adventure Settings:')}
${chalk.gray('Style:')} ${chalk.magenta(context.adventure?.worldStyle)}
${chalk.gray('Tone:')} ${chalk.magenta(context.adventure?.toneStyle)}
${chalk.gray('Magic Level:')} ${chalk.magenta(context.adventure?.magicLevel)}

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
`;
}