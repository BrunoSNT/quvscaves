import { GameContext } from './types';
import { GameReward } from './types';
import { logger } from '../logger';

export interface ContextUpdate {
    type: 'SKILL_CHECK' | 'REWARD' | 'LOOT' | 'COMBAT' | 'NARRATIVE';
    message: string;
    metadata?: any;
}

export class ContextManager {
    private context: GameContext;

    constructor(context: GameContext) {
        this.context = context;
        if (!this.context.additionalContext) {
            this.context.additionalContext = [];
        }
        logger.debug('Initialized context manager with context: ' + {
            language: context.language,
            characterCount: context.characters.length,
            existingContext: this.context.additionalContext.length
        });
    }

    public addSkillCheckResult(success: boolean, margin: number, criticalSuccess?: boolean, criticalFailure?: boolean): void {
        const outcome = success ? 
            (this.context.language === 'en-US' ? 'Success' : 'Sucesso') : 
            (this.context.language === 'en-US' ? 'Failure' : 'Falha');
        
        const marginText = this.context.language === 'en-US' ? 
            `by ${Math.abs(margin)}` : 
            `por ${Math.abs(margin)}`;

        const criticalText = criticalSuccess ? 
            (this.context.language === 'en-US' ? '(Critical Success!)' : '(Sucesso Crítico!)') :
            criticalFailure ? 
                (this.context.language === 'en-US' ? '(Critical Failure!)' : '(Falha Crítica!)') : 
                '';

        const message = `\n\n🎲 ${outcome} ${marginText} ${criticalText}`.trim();
        this.addUpdate({ type: 'SKILL_CHECK', message });
    }

    public addReward(reward: GameReward): void {
        if (!this.validateReward(reward)) {
            logger.warn('Invalid reward skipped:', reward);
            return;
        }

        const message = this.formatRewardMessage(reward);
        if (message) {
            this.addUpdate({ type: 'REWARD', message, metadata: reward });
        }
    }

    public addLoot(description: string, rewards: GameReward[]): void {
        const validRewards = rewards.filter(r => this.validateReward(r));
        
        if (description) {
            const lootMessage = this.context.language === 'en-US'
                ? `📦 ${description}`
                : `📦 ${description}`;
            this.addUpdate({ type: 'LOOT', message: lootMessage });
        }

        validRewards.forEach(reward => {
            const message = this.formatRewardMessage(reward);
            if (message) {
                this.addUpdate({ type: 'REWARD', message, metadata: reward });
            }
        });
    }

    private validateReward(reward: GameReward): boolean {
        if (!reward.type) {
            logger.warn('Reward missing type:', reward);
            return false;
        }

        switch (reward.type) {
            case 'ITEM':
                return Boolean(reward.items?.length && reward.items.every(item => 
                    item.id && item.name && item.quantity > 0 && item.type
                ));
            case 'EXPERIENCE':
                return Boolean(reward.experience && reward.experience > 0);
            case 'SPELL':
                return Boolean(reward.spell?.name && reward.spell?.level >= 0);
            case 'ABILITY':
                return Boolean(reward.ability?.name && reward.ability?.type);
            case 'GOLD':
                return Boolean(reward.gold && reward.gold > 0);
            default:
                return false;
        }
    }

    private formatRewardMessage(reward: GameReward): string | null {
        try {
            switch (reward.type) {
                case 'ITEM':
                    if (!reward.items?.length) return null;
                    return this.context.language === 'en-US'
                        ? `🎒 Obtained: ${reward.items.map(i => `${i.name} x${i.quantity}`).join(', ')}!`
                        : `🎒 Obtido: ${reward.items.map(i => `${i.name} x${i.quantity}`).join(', ')}!`;
                case 'EXPERIENCE':
                    if (!reward.experience) return null;
                    return this.context.language === 'en-US'
                        ? `⭐ Gained ${reward.experience} experience points!`
                        : `⭐ Ganhou ${reward.experience} pontos de experiência!`;
                case 'SPELL':
                    if (!reward.spell?.name) return null;
                    return this.context.language === 'en-US'
                        ? `✨ Learned new spell: ${reward.spell.name}!`
                        : `✨ Aprendeu novo feitiço: ${reward.spell.name}!`;
                case 'ABILITY':
                    if (!reward.ability?.name) return null;
                    return this.context.language === 'en-US'
                        ? `💫 Learned new ability: ${reward.ability.name}!`
                        : `💫 Aprendeu nova habilidade: ${reward.ability.name}!`;
                case 'GOLD':
                    if (!reward.gold) return null;
                    return this.context.language === 'en-US'
                        ? `💰 Received ${reward.gold} gold!`
                        : `💰 Recebeu ${reward.gold} moedas de ouro!`;
                default:
                    return reward.message || null;
            }
        } catch (error) {
            logger.error('Error formatting reward message:', error);
            return null;
        }
    }

    private addUpdate(update: ContextUpdate): void {
        logger.debug('Adding context update: ' + {
            type: update.type,
            message: update.message,
            metadata: update.metadata
        });

        if (!this.context.additionalContext) {
            this.context.additionalContext = [];
        }
        this.context.additionalContext.push(update.message);
    }

    public getFormattedContext(): string {
        if (!this.context.additionalContext?.length) return '';

        // Group updates by type
        const groups: Record<string, string[]> = {
            SKILL_CHECK: [],
            REWARD: [],
            LOOT: [],
            COMBAT: [],
            NARRATIVE: []
        };

        this.context.additionalContext.forEach(message => {
            if (message.startsWith('🎲')) groups.SKILL_CHECK.push(message);
            else if (message.startsWith('⭐') || message.startsWith('🎒') || 
                     message.startsWith('✨') || message.startsWith('💫') || 
                     message.startsWith('💰')) groups.REWARD.push(message);
            else if (message.startsWith('📦')) groups.LOOT.push(message);
            else if (message.startsWith('⚔️')) groups.COMBAT.push(message);
            else groups.NARRATIVE.push(message);
        });

        // Format each group
        const sections: string[] = [];
        if (groups.SKILL_CHECK.length) sections.push(groups.SKILL_CHECK.join('\n'));
        if (groups.COMBAT.length) sections.push(groups.COMBAT.join('\n'));
        if (groups.REWARD.length) sections.push(groups.REWARD.join('\n'));
        if (groups.LOOT.length) sections.push(groups.LOOT.join('\n'));
        if (groups.NARRATIVE.length) sections.push(groups.NARRATIVE.join('\n'));

        return sections.join('\n\n');
    }

    public getContext(): GameContext {
        return this.context;
    }
} 