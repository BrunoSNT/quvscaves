import { WorkingMemory, WorkingMemoryManager } from './types';
import { GameContext } from '../../shared/game/types';
import { logger, prettyPrintLog } from '../../shared/logger';
import { config } from '../config';

export class WorkingMemoryManagerImpl implements WorkingMemoryManager {
    private memory: WorkingMemory;
    private maxReasoningHistory: number;

    constructor() {
        this.memory = {
            promptStructure: '',
            availableTools: [],
            additionalContext: [],
            reasoningHistory: []
        };
        this.maxReasoningHistory = config.memory.maxResults;
    }

    update(memory: Partial<WorkingMemory>): void {
        try {
            // Update prompt structure if provided
            if (memory.promptStructure !== undefined) {
                this.memory.promptStructure = memory.promptStructure;
            }

            // Update available tools if provided
            if (memory.availableTools !== undefined) {
                this.memory.availableTools = memory.availableTools;
            }

            // Update additional context if provided
            if (memory.additionalContext !== undefined) {
                this.memory.additionalContext = memory.additionalContext;
            }

            // Update reasoning history if provided
            if (memory.reasoningHistory !== undefined) {
                this.memory.reasoningHistory = memory.reasoningHistory;
                // Keep only last N reasoning entries
                if (this.memory.reasoningHistory.length > this.maxReasoningHistory) {
                    this.memory.reasoningHistory = this.memory.reasoningHistory.slice(-this.maxReasoningHistory);
                }
            }

            // Update current context if provided
            if (memory.currentContext !== undefined) {
                this.memory.currentContext = memory.currentContext;
            }

            logger.debug('Updated working memory:\n' + prettyPrintLog(JSON.stringify(this.memory)));
        } catch (error) {
            logger.error('Error updating working memory:\n' + prettyPrintLog(JSON.stringify(error)));
            throw error;
        }
    }

    get(): WorkingMemory {
        return { ...this.memory };
    }

    clear(): void {
        this.memory = {
            promptStructure: '',
            availableTools: [],
            additionalContext: [],
            reasoningHistory: []
        };
        logger.debug('Cleared working memory');
    }

    updateContext(context: GameContext): void {
        this.memory.currentContext = context;
        logger.debug('Updated game context in working memory');
    }

    addReasoning(reasoning: string): void {
        this.memory.reasoningHistory.push(reasoning);
        // Keep only last N reasoning entries
        if (this.memory.reasoningHistory.length > this.maxReasoningHistory) {
            this.memory.reasoningHistory.shift();
        }
        logger.debug('Added reasoning to history:', reasoning);
    }

    getRecentReasoning(limit: number = config.memory.maxResults): string[] {
        return this.memory.reasoningHistory.slice(-limit);
    }
} 