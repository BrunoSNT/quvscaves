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
import { SkillCheck, SkillCheckResult, formatSkillCheckResult } from '../shared/game/skills';
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

    async generateResponse(context: GameContext): Promise<string> {
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount < this.maxRetries) {
            try {
                const response = await this.attemptResponse(context, retryCount);
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

    private async attemptResponse(context: GameContext, retryCount: number): Promise<string> {
        const spinner = ora({
            text: chalk.cyan('Generating AI response...\n\n'),
            spinner: 'dots12'
        });

        try {
            // Get enhanced context from orchestrator
            const enhancedContext = await this.orchestrator.getEnhancedContext(context);
            
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

            const prompt = getGamePrompt(language as SupportedLanguage);
            const contextStr = buildContextString(enhancedContext, language as SupportedLanguage);

            // Construct the full prompt
            const fullPrompt = `<|im_start|>system
${prompt.system}
${prompt.intro}

CURRENT GAME CONTEXT:
${contextStr}

ADDITIONAL CONTEXT:
${enhancedContext.additionalContext?.join('\n')}

REASONING HISTORY:
${enhancedContext.reasoning?.join('\n')}

RESPONSE FORMAT:
You MUST respond with a valid JSON object. No other text or formatting is allowed.
The response must match this exact structure for ${language === 'en-US' ? 'English' : 'Portuguese'}:

${language === 'en-US' ? `{
    "narration": "Vivid book like description introducing new story elements and develiping the plot. MUST advance plot and show consequences. DO NOT REPEAT previous scenes. Between 800 and 1200 characters.",
    "atmosphere": "(Optional) Current mood, weather, and environmental details",
    "available_actions": [
        "Action 1 that leads to new discoveries or progression",
        "Action 2 that develops character relationships",
        "Action 3 that advances the current situation",
        "Action 4 that asks for more details and information about the scene or character",
        "Action 5 that regresses the current situation"
    ]
}` : `{
    "narracao": "Descrição vívida, como em livro, introduzindo novos elementos e desenvolvendo o enredo. DEVE avançar a história e mostrar consequências. NÃO REPITA cenas anteriores. Entre 800 e 1200 caracteres.",
    "atmosfera": "(Opcional) Humor atual, clima e detalhes do ambiente",
    "acoes_disponiveis": [
        "Ação 1 que leva a novas descobertas ou progressão",
        "Ação 2 que desenvolve relacionamentos",
        "Ação 3 que avança a situação atual",
        "Ação 4 pede mais detalhes e informações sobre a cena ou personagem",
        "Ação 5 que regride a situação atual",
    ]
}`}
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

            // Log the full prompt
            logger.debug('Full AI Prompt:\n' + prettyPrintLog(fullPrompt) + "\n\n");

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
                await this.orchestrator.processInput(context.playerActions[0], context);
                await this.orchestrator.storeResponse(JSON.stringify(responseContent), context);

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

        if (language === 'en-US') {
            return (
                typeof response.narration === 'string' &&
                Array.isArray(response.available_actions) &&
                response.available_actions.length > 0
            );
        } else {
            return (
                typeof response.narracao === 'string' &&
                Array.isArray(response.acoes_disponiveis) &&
                response.acoes_disponiveis.length > 0
            );
        }
    }

    private formatResponse(response: any, language: SupportedLanguage): string {
        if (language === 'en-US') {
            return `${response.narration}\n\n${response.atmosphere ? `Atmosphere: ${response.atmosphere}\n\n` : ''}Available Actions:\n${response.available_actions.map((action: string) => `• ${action}`).join('\n')}`;
        } else {
            return `${response.narracao}\n\n${response.atmosfera ? `Atmosfera: ${response.atmosfera}\n\n` : ''}Ações Disponíveis:\n${response.acoes_disponiveis.map((action: string) => `• ${action}`).join('\n')}`;
        }
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