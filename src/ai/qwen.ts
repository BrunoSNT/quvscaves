import axios from 'axios';
import { logger } from '../shared/logger';

interface QwenOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stop?: string[];
}

export class QwenClient {
    private endpoint: string;
    private model: string;

    constructor(adventureId: string) {
        this.endpoint = process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate';
        this.model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    }

    public async complete(prompt: string, options: QwenOptions = {}): Promise<string> {
        try {
            const response = await axios.post(this.endpoint, {
                model: this.model,
                prompt: prompt,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 500,
                top_p: options.topP || 0.95,
                stop: options.stop || ["}"],
                stream: false
            });

            if (typeof response.data === 'object' && response.data.response) {
                return response.data.response;
            }

            logger.error('Invalid Qwen response format:', response.data);
            throw new Error('Invalid response format from Qwen');
        } catch (error) {
            logger.error('Error in Qwen completion:', error);
            throw error;
        }
    }
} 