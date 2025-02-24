import { EpisodicMemory, EpisodicMemoryManager } from './types';
import { VectorStore } from '../vector/store';
import { logger, formatGenericOutput } from '../../shared/logger';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class EpisodicMemoryManagerImpl implements EpisodicMemoryManager {
    private vectorStore: VectorStore;
    private memories: Map<string, EpisodicMemory>;
    private adventureId: string;

    constructor(adventureId: string) {
        this.vectorStore = VectorStore.getInstance();
        this.memories = new Map();
        this.adventureId = adventureId;
    }

    private getLogPath(): string {
        const logDir = path.join(process.cwd(), config.memory.exportPath, this.adventureId);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        return path.join(logDir, 'interactions.jsonl');
    }

    async add(memory: EpisodicMemory): Promise<void> {
        const id = memory.id || uuidv4();
        memory.id = id;

        try {
            const embedding = await this.vectorStore.getEmbedding(memory.content);
            memory.embedding = embedding;

            this.memories.set(id, memory);

            await this.vectorStore.addEntry({
                id,
                vector: embedding,
                metadata: {
                    type: memory.type,
                    timestamp: memory.timestamp.toISOString(),
                    ...memory.metadata
                }
            });

            const logEntry = JSON.stringify({
                id,
                type: memory.type,
                content: memory.content,
                timestamp: memory.timestamp.toISOString(),
                metadata: memory.metadata
            }) + '\n';

            fs.appendFileSync(this.getLogPath(), logEntry);

            logger.info(`Added episodic memory ${id}`);
        } catch (error) {
            logger.error('Error adding episodic memory:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async search(query: string, limit: number = config.memory.maxResults): Promise<EpisodicMemory[]> {
        try {
            const queryEmbedding = await this.vectorStore.getEmbedding(query);
            const results = await this.vectorStore.search(queryEmbedding, limit);

            return results
                .map(result => this.memories.get(result.id))
                .filter((memory): memory is EpisodicMemory => memory !== undefined)
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        } catch (error) {
            logger.error('Error searching episodic memories:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async getRecent(limit: number = config.memory.maxResults): Promise<EpisodicMemory[]> {
        return Array.from(this.memories.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }
} 