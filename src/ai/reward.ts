import { HybridAnalyzer, AnalyzerConfig } from './analyzer';
import { GameContext } from '../shared/game/types';
import { GameReward } from '../shared/game/types';
import { logger, formatGenericOutput } from '../shared/logger';

const REWARD_CONCEPTS = [
    "chest", "treasure", "reward", "find", "discover", "obtain", "receive", "loot",
    "gold", "coins", "items", "equipment", "gear", "weapons", "armor",
    "complete quest", "finish task", "accomplish", "achieve"
];

export class RewardAnalyzer extends HybridAnalyzer<GameReward[]> {
    private static instance: RewardAnalyzer;

    private constructor(adventureId: string) {
        const config: AnalyzerConfig = {
            embeddings: {
                concepts: REWARD_CONCEPTS,
                confidenceThreshold: 0.8
            },
            llm: {
                systemPrompt: `You are a reward determination system for a fantasy RPG. Analyze actions and context to determine appropriate rewards.

Consider the following when determining rewards:
1. Action difficulty and risk
2. Character's current progression
3. Story context and quest progress
4. Balance and game economy

Return a JSON array of rewards following this structure:
{
    "rewards": [
        {
            "type": "ITEM"|"EXPERIENCE"|"SPELL"|"ABILITY"|"GOLD",
            "message": "Reward description",
            // Additional fields based on type...
        }
    ]
}

Only return rewards if they make sense for the action and context.`,
                temperature: 0.7
            }
        };
        super(adventureId, config);
    }

    public static getInstance(adventureId: string): RewardAnalyzer {
        if (!RewardAnalyzer.instance) {
            RewardAnalyzer.instance = new RewardAnalyzer(adventureId);
        }
        return RewardAnalyzer.instance;
    }

    protected async generateQuickResult(
        action: string,
        context: GameContext,
        confidence: number
    ): Promise<GameReward[] | null> {
        const rewards: GameReward[] = [];
        const characterLevel = context.characters[0]?.level || 1;

        // Basic experience reward based on character level
        rewards.push({
            type: 'EXPERIENCE',
            experience: Math.floor(50 * characterLevel * (Math.random() * 0.4 + 0.8)), // 80-120% of base XP
            message: context.language === 'en-US' 
                ? 'Gained experience from the action'
                : 'Ganhou experiência da ação'
        });

        // Random chance for gold (50%)
        if (Math.random() > 0.5) {
            rewards.push({
                type: 'GOLD',
                gold: Math.floor(10 * characterLevel * (Math.random() * 0.6 + 0.7)), // 70-130% of base gold
                message: context.language === 'en-US'
                    ? 'Found some gold'
                    : 'Encontrou algumas moedas de ouro'
            });
        }

        // Small chance for an item (20%)
        if (Math.random() > 0.8) {
            rewards.push({
                type: 'ITEM',
                items: [{
                    id: `common_item_${Date.now()}`,
                    name: context.language === 'en-US' ? 'Health Potion' : 'Poção de Cura',
                    description: context.language === 'en-US' 
                        ? 'Restores some health when consumed'
                        : 'Restaura um pouco de vida quando consumida',
                    quantity: 1,
                    type: 'CONSUMABLE'
                }],
                message: context.language === 'en-US'
                    ? 'Found a useful item'
                    : 'Encontrou um item útil'
            });
        }

        return rewards;
    }

    protected buildLLMPrompt(action: string, context: GameContext): string {
        const character = context.characters[0];
        const recentEvents = context.memory.recentScenes.map(scene => scene.summary).join('\n');

        return `<|im_start|>system
${this.config.llm.systemPrompt}

Current Context:
Character Level: ${character?.level || 1}
Character Class: ${character?.class || 'unknown'}
Action: ${action}
Recent Events: ${recentEvents}
<|im_end|>
<|im_start|>user
Determine appropriate rewards for this action.
<|im_end|>
<|im_start|>assistant`;
    }

    protected parseLLMResponse(response: string): GameReward[] | null {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.rewards || null;
        } catch (error) {
            logger.error('Error parsing LLM reward response:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }
} 