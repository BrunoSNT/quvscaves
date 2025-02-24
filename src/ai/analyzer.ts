import { VectorStore } from '../core/vector/store';
import { QwenClient } from './qwen';
import { logger, formatGenericOutput } from '../shared/logger';
import { GameContext } from '../shared/game/types';

export interface AnalysisResult<T> {
    result: T | null;
    confidence: number;
}

export interface AnalyzerConfig {
    embeddings: {
        concepts: string[];
        confidenceThreshold: number;
    };
    llm: {
        systemPrompt: string;
        temperature?: number;
        maxTokens?: number;
    };
}

export abstract class HybridAnalyzer<T> {
    protected vectorStore: VectorStore;
    protected llm: QwenClient;
    protected config: AnalyzerConfig;

    constructor(adventureId: string, config: AnalyzerConfig) {
        this.vectorStore = VectorStore.getInstance();
        this.llm = new QwenClient(adventureId);
        this.config = config;
    }

    public async analyze(action: string, context: GameContext): Promise<T | null> {
        try {
            // First try quick embedding-based check
            const { result, confidence } = await this.quickEmbeddingCheck(action, context);
            
            // If we're confident in the embedding result, use it
            if (confidence > this.config.embeddings.confidenceThreshold && result) {
                logger.info(`Using embedding-based analysis (confidence: ${confidence})`);
                return result;
            }

            // If confidence is low or no result found, use LLM
            logger.info(`Using LLM for analysis (embedding confidence: ${confidence})`);
            return await this.llmAnalysis(action, context);
        } catch (error) {
            logger.error('Error in hybrid analysis:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }

    protected async quickEmbeddingCheck(action: string, context: GameContext): Promise<AnalysisResult<T>> {
        try {
            const { similarity } = await this.vectorStore.compareWithConcepts(
                action.toLowerCase(),
                this.config.embeddings.concepts
            );

            if (similarity < 0.3) {
                return { result: null, confidence: similarity };
            }

            const result = await this.generateQuickResult(action, context, similarity);
            return { result, confidence: similarity };
        } catch (error) {
            logger.error('Error in quick embedding check:' + formatGenericOutput(JSON.stringify(error)));
            return { result: null, confidence: 0 };
        }
    }

    protected async llmAnalysis(action: string, context: GameContext): Promise<T | null> {
        try {
            const prompt = this.buildLLMPrompt(action, context);
            const response = await this.llm.complete(prompt, {
                temperature: this.config.llm.temperature || 0.7,
                maxTokens: this.config.llm.maxTokens || 500
            });

            return this.parseLLMResponse(response);
        } catch (error) {
            logger.error('Error in LLM analysis:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }

    protected abstract generateQuickResult(action: string, context: GameContext, confidence: number): Promise<T | null>;
    protected abstract buildLLMPrompt(action: string, context: GameContext): string;
    protected abstract parseLLMResponse(response: string): T | null;
} 