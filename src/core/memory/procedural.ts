import { ProceduralMemory, ProceduralMemoryManager } from './types';
import { logger, formatGenericOutput } from '../../shared/logger';
import { v4 as uuidv4 } from 'uuid';

export class ProceduralMemoryManagerImpl implements ProceduralMemoryManager {
    private prompts: Map<string, ProceduralMemory>;
    private tools: Map<string, ProceduralMemory>;

    constructor() {
        this.prompts = new Map();
        this.tools = new Map();
    }

    async registerPrompt(prompt: ProceduralMemory): Promise<void> {
        const id = prompt.id || uuidv4();
        prompt.id = id;
        prompt.type = 'prompt';

        try {
            this.prompts.set(id, prompt);
            logger.info(`Registered prompt ${id}: ${prompt.name}`);
        } catch (error) {
            logger.error('Error registering prompt:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async registerTool(tool: ProceduralMemory): Promise<void> {
        const id = tool.id || uuidv4();
        tool.id = id;
        tool.type = 'tool';

        try {
            this.tools.set(id, tool);
            logger.info(`Registered tool ${id}: ${tool.name}`);
        } catch (error) {
            logger.error('Error registering tool:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async getPrompts(): Promise<ProceduralMemory[]> {
        return Array.from(this.prompts.values());
    }

    async getTools(): Promise<ProceduralMemory[]> {
        return Array.from(this.tools.values());
    }

    async getPromptByName(name: string): Promise<ProceduralMemory | undefined> {
        return Array.from(this.prompts.values()).find(p => p.name === name);
    }

    async getToolByName(name: string): Promise<ProceduralMemory | undefined> {
        return Array.from(this.tools.values()).find(t => t.name === name);
    }

    async validateParameters(memory: ProceduralMemory, parameters: Record<string, any>): Promise<boolean> {
        const requiredParams = Object.keys(memory.parameters);
        const providedParams = Object.keys(parameters);

        // Check if all required parameters are provided
        const missingParams = requiredParams.filter(param => !providedParams.includes(param));
        if (missingParams.length > 0) {
            logger.warn(`Missing required parameters for ${memory.name}: ${missingParams.join(', ')}`);
            return false;
        }

        // Check parameter types (basic validation)
        for (const [key, value] of Object.entries(parameters)) {
            const expectedType = memory.parameters[key];
            if (expectedType && typeof value !== expectedType) {
                logger.warn(`Invalid type for parameter ${key} in ${memory.name}. Expected ${expectedType}, got ${typeof value}`);
                return false;
            }
        }

        return true;
    }
} 