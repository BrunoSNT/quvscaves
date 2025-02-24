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
            logger.debug('Analyzing action for skill check: ' + {
                action,
                context: context.additionalContext
            });

            const skillCheck = await this.skillCheckAnalyzer.analyze(action, context);
            
            if (skillCheck) {
                logger.info('Determined skill check: ' + {
                    skill: skillCheck.skill,
                    difficulty: skillCheck.difficulty,
                    advantage: skillCheck.advantage,
                    disadvantage: skillCheck.disadvantage
                });
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
                    // Validate the response is proper JSON
                    try {
                        const parsed = JSON.parse(response);
                        const requiredFields = context.language === 'en-US' 
                            ? ['world_context', 'narration', 'atmosphere', 'available_actions']
                            : ['contexto_mundo', 'narracao', 'atmosfera', 'acoes_disponiveis'];
                        
                        const missingFields = requiredFields.filter(field => !parsed[field]);
                        if (missingFields.length > 0) {
                            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
                        }
                        
                        logger.info('Successfully generated valid response');
                        return response;
                    } catch (parseError) {
                        logger.error('Response validation failed: ' + formatGenericOutput(JSON.stringify(parseError)));
                        throw parseError;
                    }
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
            logger.info('Raw AI Response Content:' + prettyPrintLog(response.data.response));

            let responseContent: any;
            
            try {
                // Extract the response content
                if (typeof response.data === 'object' && response.data.response) {
                    // Try to find a valid JSON object in the response
                    const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        logger.debug('Found JSON in response:' + formatGenericOutput(JSON.stringify(jsonMatch[0])));
                        responseContent = JSON.parse(jsonMatch[0]);
                        logger.debug('Parsed JSON content:' + formatGenericOutput(JSON.stringify(responseContent)));
                    } else {
                        logger.error('No JSON object found in response:' + formatGenericOutput(JSON.stringify(response.data.response)));
                        throw new Error('No valid JSON found in response');
                    }
                } else if (typeof response.data === 'string') {
                    const jsonMatch = response.data.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        logger.debug('Found JSON in string response:' + formatGenericOutput(JSON.stringify(jsonMatch[0])));
                        responseContent = JSON.parse(jsonMatch[0]);
                        logger.debug('Parsed JSON content:' + formatGenericOutput(JSON.stringify(responseContent)));
                    } else {
                        logger.error('No JSON object found in response string:' + formatGenericOutput(JSON.stringify(response.data)));
                        throw new Error('No valid JSON found in response');
                    }
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
                logger.error('Error parsing AI response:' + formatGenericOutput(JSON.stringify(error)));
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

        // Check required fields based on language
        const requiredFields = language === 'en-US' 
            ? {
                world_context: 'string',
                narration: 'string',
                available_actions: 'array'
            }
            : {
                contexto_mundo: 'string',
                narracao: 'string',
                acoes_disponiveis: 'array'
            };

        // Validate all required fields exist and are not placeholder text
        for (const [field, type] of Object.entries(requiredFields)) {
            if (!response[field]) {
                logger.error(`Missing required field: ${field}`);
                return false;
            }

            // Check for placeholder text
            if (type === 'string') {
                const text = response[field];
                if (typeof text !== 'string' || text.trim().length === 0) {
                    logger.error(`Empty or invalid text for field: ${field}`);
                    return false;
                }

                // Check for placeholder text in Portuguese
                if (language === 'pt-BR') {
                    if (field === 'contexto_mundo' && text === 'Visão detalhada da história e estado atual do mundo') {
                        logger.error('Placeholder text detected for world context');
                        return false;
                    }
                    if (field === 'narracao' && text === 'Descrição vívida dos arredores imediatos e da situação em um contexto de mundo amplo para que possamos entender a narrativa inicial') {
                        logger.error('Placeholder text detected for narration');
                        return false;
                    }
                }

                // Log the actual content for debugging
                logger.debug(`Content for ${field}:`, text.substring(0, 100) + '...');
            } else if (type === 'array') {
                if (!Array.isArray(response[field]) || response[field].length === 0) {
                    logger.error(`Invalid or empty array for field: ${field}`);
                    return false;
                }
                // Log the actions for debugging
                logger.debug(`Actions for ${field}:`, response[field]);
            }
        }

        // Split each text field into chunks at sentence boundaries
        const narrationField = language === 'en-US' ? 'narration' : 'narracao';
        const worldContextField = language === 'en-US' ? 'world_context' : 'contexto_mundo';
        const atmosphereField = language === 'en-US' ? 'atmosphere' : 'atmosfera';

        // Process each text field
        [narrationField, worldContextField, atmosphereField].forEach(field => {
            if (response[field] && typeof response[field] === 'string') {
                logger.debug(`Processing ${field} for chunking...`);
                const originalLength = response[field].length;
                response[field] = this.splitIntoChunks(response[field]);
                logger.debug(`${field} processed: ${originalLength} chars -> ${response[field].length} chars`);
            }
        });

        return true;
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
            logger.debug('Analyzing action for rewards: ' + {
                action,
                context: context.additionalContext
            });

            const rewards = await this.rewardAnalyzer.analyze(action, context);
            
            if (rewards?.length) {
                logger.info('Determined rewards: ' + {
                    count: rewards.length,
                    types: rewards.map(r => r.type)
                });
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