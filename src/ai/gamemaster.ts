import { GameContext } from '../shared/game/types';
import { SupportedLanguage } from '../shared/i18n/types';
import { logger, prettyPrintLog } from '../shared/logger';
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
            logger.debug('Analyzing action for skill check:', {
                action,
                context: context.additionalContext
            });

            const skillCheck = await this.skillCheckAnalyzer.analyze(action, context);
            
            if (skillCheck) {
                logger.info('Determined skill check:', {
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
            logger.error('Error determining skill check:', error);
            return null;
        }
    }

    async generateResponse(context: GameContext, customPrompt?: string): Promise<string> {
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount < this.maxRetries) {
            try {
                const response = await this.attemptResponse(context, retryCount, customPrompt);
                if (response) {
                    return response;
                }
                retryCount++;
            } catch (error) {
                lastError = error as Error;
                logger.error(`Error generating response (attempt ${retryCount + 1}):`, error);
                retryCount++;
            }
        }

        // If all retries failed, return a fallback response
        logger.error('All response generation attempts failed:', lastError);
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
                logger.warn('Error getting enhanced context:', error);
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
            })) + "\n\n");
            console.log('Custom Prompt -> ');
            console.log(customPrompt);
            // Log the full prompt
            logger.debug('Full AI Prompt:\n' + prettyPrintLog(customPrompt ? customPrompt : fullPrompt) + "\n\n");

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

            // Log the raw response from the AI
            logger.debug('Raw AI Response:\n' + prettyPrintLog(JSON.stringify({
                responseType: typeof response.data,
                responseLength: typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length
            })) + "\n\n");

            let responseContent: any;
            
            try {
                // Extract the response content
                if (typeof response.data === 'object' && response.data.response) {
                    // Try to find a valid JSON object in the response
                    const jsonMatch = response.data.response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        responseContent = JSON.parse(jsonMatch[0]);
                        logger.debug('Extracted JSON from response object:\n' + prettyPrintLog(JSON.stringify({
                            extractedJson: jsonMatch[0],
                            parsedContent: responseContent
                        })) + "\n\n");
                    } else {
                        logger.error('No JSON object found in response:', response.data.response);
                        throw new Error('No valid JSON found in response');
                    }
                } else if (typeof response.data === 'string') {
                    const jsonMatch = response.data.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        responseContent = JSON.parse(jsonMatch[0]);
                        logger.debug('Extracted JSON from response string:\n' + prettyPrintLog(JSON.stringify({
                            extractedJson: jsonMatch[0],
                            parsedContent: responseContent
                        })) + "\n\n");
                    } else {
                        logger.error('No JSON object found in response string:', response.data);
                        throw new Error('No valid JSON found in response');
                    }
                }

                // Validate response structure
                if (!this.isValidResponse(responseContent, language as SupportedLanguage)) {
                    logger.error('Invalid response structure:\n' + prettyPrintLog(JSON.stringify({
                        responseContent,
                        expectedKeys: language === 'en-US' 
                            ? ['narration', 'available_actions'] 
                            : ['narracao', 'acoes_disponiveis']
                    })) + "\n\n");
                    throw new Error('Invalid response structure');
                }

                // Only process input and store response after validation
                try {
                    await this.orchestrator.processInput(context.playerActions[0], context);
                } catch (error) {
                    logger.warn('Error storing input memory:', error);
                    // Continue even if memory storage fails
                }

                try {
                    await this.orchestrator.storeResponse(JSON.stringify(responseContent), context);
                } catch (error) {
                    logger.warn('Error storing response memory:', error);
                    // Continue even if memory storage fails
                }

                spinner.stop();
                return JSON.stringify(responseContent);
            } catch (error) {
                logger.error('Error parsing AI response:', error);
                throw error;
            }
        } catch (error) {
            spinner.stop();
            throw error;
        }
    }

    private isValidResponse(response: any, language: SupportedLanguage): boolean {
        if (!response || typeof response !== 'object') return false;

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

        // Validate all required fields exist
        for (const [field, type] of Object.entries(requiredFields)) {
            if (!response[field]) {
                logger.error(`Missing required field: ${field}`);
                return false;
            }
            
            if (type === 'array') {
                // Handle both array and object formats
                if (Array.isArray(response[field])) {
                    if (response[field].length === 0) {
                        logger.error(`Empty array for field: ${field}`);
                        return false;
                    }
                } else if (typeof response[field] === 'object') {
                    // Convert object format to array
                    const values = Object.values(response[field]);
                    if (values.length === 0) {
                        logger.error(`Empty object for field: ${field}`);
                        return false;
                    }
                    response[field] = values;
                } else {
                    logger.error(`Invalid type for field: ${field}, expected array or object, got ${typeof response[field]}`);
                    return false;
                }
            } else if (type === 'string' && typeof response[field] !== 'string') {
                logger.error(`Invalid type for field: ${field}, expected string, got ${typeof response[field]}`);
                return false;
            }
        }

        // Split long messages into chunks for better voice processing
        const narrationField = language === 'en-US' ? 'narration' : 'narracao';
        const worldContextField = language === 'en-US' ? 'world_context' : 'contexto_mundo';
        const atmosphereField = language === 'en-US' ? 'atmosphere' : 'atmosfera';

        // Split each field into chunks at sentence boundaries
        if (response[narrationField]) {
            response[narrationField] = this.splitIntoChunks(response[narrationField]);
        }
        if (response[worldContextField]) {
            response[worldContextField] = this.splitIntoChunks(response[worldContextField]);
        }
        if (response[atmosphereField]) {
            response[atmosphereField] = this.splitIntoChunks(response[atmosphereField]);
        }

        return true;
    }

    private splitIntoChunks(text: string): string {
        // Split text into chunks at sentence boundaries
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
        const chunks: string[] = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            // If adding this sentence would make the chunk too long, start a new chunk
            if ((currentChunk + sentence).length > 500) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk += sentence;
            }
        }

        // Add the last chunk if there is one
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        // Join chunks with a space
        return chunks.join(' ');
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
            logger.debug('Analyzing action for rewards:', {
                action,
                context: context.additionalContext
            });

            const rewards = await this.rewardAnalyzer.analyze(action, context);
            
            if (rewards?.length) {
                logger.info('Determined rewards:', {
                    count: rewards.length,
                    types: rewards.map(r => r.type)
                });
            } else {
                logger.debug('No rewards determined for action');
            }

            return rewards;
        } catch (error) {
            logger.error('Error determining rewards:', error);
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