import { ChromaClient, Collection } from 'chromadb';
import { VectorEntry, VectorSearchResult } from '../memory/types';
import { logger } from '../../shared/logger';
import { config } from '../config';
import axios from 'axios';

export class VectorStore {
    private client: ChromaClient;
    private collection: Collection | null = null;
    private static instance: VectorStore;
    private embeddingCache: Map<string, number[]>;

    private constructor() {
        this.client = new ChromaClient({
            path: config.vector.chromaUrl
        });
        this.embeddingCache = new Map();
    }

    public static getInstance(): VectorStore {
        if (!VectorStore.instance) {
            VectorStore.instance = new VectorStore();
        }
        return VectorStore.instance;
    }

    async initialize(collectionName: string = 'memory_embeddings') {
        if (!this.collection) {
            try {
                this.collection = await this.client.getOrCreateCollection({
                    name: collectionName,
                    metadata: { description: "Memory system embeddings" }
                });
                logger.info(`Successfully initialized ChromaDB collection: ${collectionName}`);
            } catch (error) {
                logger.error('Error initializing ChromaDB collection:', error);
                throw error;
            }
        }
    }

    async addEntry(entry: VectorEntry): Promise<void> {
        await this.initialize();
        
        if (!this.collection) {
            throw new Error('Collection not initialized');
        }

        try {
            await this.collection.add({
                ids: [entry.id],
                embeddings: [entry.vector],
                metadatas: [entry.metadata]
            });
            logger.info(`Successfully added entry ${entry.id} to vector store`);
        } catch (error) {
            logger.error(`Error adding entry ${entry.id} to vector store:`, error);
            throw error;
        }
    }

    async search(vector: number[], limit: number = 5): Promise<VectorSearchResult[]> {
        await this.initialize();
        
        if (!this.collection) {
            throw new Error('Collection not initialized');
        }

        try {
            const results = await this.collection.query({
                queryEmbeddings: [vector],
                nResults: limit
            });

            return (results.ids[0] || []).map((id, index) => ({
                id,
                score: results.distances?.[0]?.[index] || 0,
                metadata: results.metadatas?.[0]?.[index] || {}
            }));
        } catch (error) {
            logger.error('Error searching vector store:', error);
            throw error;
        }
    }

    async getEmbedding(text: string): Promise<number[]> {
        const cached = this.embeddingCache.get(text);
        if (cached) {
            return cached;
        }

        try {
            const response = await axios.post(`${config.vector.ollamaUrl}/api/embeddings`, {
                model: config.vector.ollamaEmbeddingModel,
                prompt: text
            });

            const embedding = response.data.embedding;
            this.embeddingCache.set(text, embedding);

            if (this.embeddingCache.size > config.memory.cacheSize) {
                const oldestKey = this.embeddingCache.keys().next().value;
                this.embeddingCache.delete(oldestKey!);
            }

            return embedding;
        } catch (error) {
            logger.error('Error getting embedding:', error);
            throw error;
        }
    }

    async compareTexts(text1: string, text2: string): Promise<number> {
        const [embedding1, embedding2] = await Promise.all([
            this.getEmbedding(text1),
            this.getEmbedding(text2)
        ]);
        
        return this.calculateSimilarity(embedding1, embedding2);
    }

    public calculateSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) {
            throw new Error('Vectors must have the same length');
        }

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        norm1 = Math.sqrt(norm1);
        norm2 = Math.sqrt(norm2);

        return dotProduct / (norm1 * norm2);
    }

    async compareWithConcepts(text: string, concepts: string[]): Promise<{ similarity: number }> {
        const textEmbedding = await this.getEmbedding(text);
        const conceptEmbeddings = await Promise.all(concepts.map(c => this.getEmbedding(c)));
        
        const similarities = conceptEmbeddings.map(e => this.calculateSimilarity(textEmbedding, e));
        const maxSimilarity = Math.max(...similarities);
        
        return { similarity: maxSimilarity };
    }
} 