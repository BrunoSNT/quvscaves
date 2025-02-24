import { SemanticMemory, SemanticMemoryManager } from './types';
import { VectorStore } from '../vector/store';
import { logger } from '../../shared/logger';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { formatGenericOutput } from '../../shared/logger';

export class SemanticMemoryManagerImpl implements SemanticMemoryManager {
    private vectorStore: VectorStore;
    private memories: Map<string, SemanticMemory>;
    private notionConfig?: {
        apiKey: string;
        databaseId: string;
    };

    constructor(notionConfig?: { apiKey: string; databaseId: string }) {
        this.vectorStore = VectorStore.getInstance();
        this.memories = new Map();
        this.notionConfig = notionConfig || {
            apiKey: config.knowledge.notionApiKey || '',
            databaseId: config.knowledge.notionDatabaseId || ''
        };
    }

    async addKnowledge(memory: SemanticMemory): Promise<void> {
        const id = memory.id || uuidv4();
        memory.id = id;
        memory.type = 'knowledge';

        try {
            const embedding = await this.vectorStore.getEmbedding(memory.content);
            memory.embedding = embedding;

            this.memories.set(id, memory);

            await this.vectorStore.addEntry({
                id,
                vector: embedding,
                metadata: {
                    type: memory.type,
                    source: memory.source,
                    ...memory.metadata
                }
            });

            logger.info(`Added knowledge memory ${id} from source ${memory.source}`);
        } catch (error) {
            logger.error('Error adding knowledge memory:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async addGrounding(memory: SemanticMemory): Promise<void> {
        const id = memory.id || uuidv4();
        memory.id = id;
        memory.type = 'grounding';

        try {
            const embedding = await this.vectorStore.getEmbedding(memory.content);
            memory.embedding = embedding;

            this.memories.set(id, memory);

            await this.vectorStore.addEntry({
                id,
                vector: embedding,
                metadata: {
                    type: memory.type,
                    source: memory.source,
                    ...memory.metadata
                }
            });

            logger.info(`Added grounding memory ${id} from source ${memory.source}`);
        } catch (error) {
            logger.error('Error adding grounding memory:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async search(query: string, limit: number = config.memory.maxResults): Promise<SemanticMemory[]> {
        try {
            const queryEmbedding = await this.vectorStore.getEmbedding(query);
            const results = await this.vectorStore.search(queryEmbedding, limit);

            return results
                .map(result => this.memories.get(result.id))
                .filter((memory): memory is SemanticMemory => memory !== undefined);
        } catch (error) {
            logger.error('Error searching semantic memories:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async syncWithNotion(): Promise<void> {
        if (!this.notionConfig?.apiKey || !this.notionConfig?.databaseId) {
            logger.warn('Notion config not provided, skipping sync');
            return;
        }

        try {
            const response = await axios.post(
                `https://api.notion.com/v1/databases/${this.notionConfig.databaseId}/query`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${this.notionConfig.apiKey}`,
                        'Notion-Version': '2022-06-28'
                    }
                }
            );

            for (const page of response.data.results) {
                const content = page.properties.Content?.rich_text[0]?.text?.content;
                if (content) {
                    await this.addKnowledge({
                        id: page.id,
                        type: 'knowledge',
                        content,
                        source: 'notion',
                        metadata: {
                            title: page.properties.Title?.title[0]?.text?.content,
                            lastEdited: page.last_edited_time
                        }
                    });
                }
            }

            logger.info('Successfully synced with Notion');
        } catch (error) {
            logger.error('Error syncing with Notion:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }
} 