import { ChromaClient, Collection, GetCollectionParams } from 'chromadb';
import { logger } from '../logger';
import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

interface EmbeddingResponse {
    embedding: number[];
}

class VectorStore {
    private client: ChromaClient;
    private collection: Collection | null = null;
    private static instance: VectorStore;
    private embeddingCache: Map<string, number[]>;

    private constructor() {
        this.client = new ChromaClient({
            path: process.env.CHROMA_DB_URL || 'http://localhost:8000',
            fetchOptions: {
                keepalive: true,
                mode: 'cors'
            }
        });
        
        this.embeddingCache = new Map();
        
        if (!process.env.CHROMA_DB_URL) {
            logger.info('Using local ChromaDB in client mode');
        }
    }

    public static getInstance(): VectorStore {
        if (!VectorStore.instance) {
            VectorStore.instance = new VectorStore();
        }
        return VectorStore.instance;
    }

    private async getEmbedding(text: string): Promise<number[]> {
        // Check cache first
        const cached = this.embeddingCache.get(text);
        if (cached) {
            return cached;
        }

        try {
            const response = await axios.post<EmbeddingResponse>(`${OLLAMA_URL}/api/embeddings`, {
                model: EMBEDDING_MODEL,
                prompt: text
            });
            
            // Cache the result
            this.embeddingCache.set(text, response.data.embedding);
            
            // If cache gets too large, remove oldest entries
            if (this.embeddingCache.size > 1000) {
                const oldestKey = this.embeddingCache.keys().next().value;
                this.embeddingCache.delete(oldestKey!);
            }
            
            return response.data.embedding;
        } catch (error) {
            logger.error('Error getting embedding:', error);
            throw error;
        }
    }

    private async getEmbeddings(texts: (string | undefined)[]): Promise<number[][]> {
        const validTexts = texts.map(text => text || '');
        const cachedEmbeddings = validTexts.map(text => this.embeddingCache.get(text));
        
        if (cachedEmbeddings.every(embedding => embedding !== undefined)) {
            return cachedEmbeddings.filter((embedding): embedding is number[] => embedding !== undefined);
        }

        try {
            const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
                model: EMBEDDING_MODEL,
                prompt: validTexts.join('\n')
            });

            const embeddings = response.data.embeddings;
            
            // Cache the new embeddings
            validTexts.forEach((text, index) => {
                this.embeddingCache.set(text, embeddings[index]);
            });

            return embeddings;
        } catch (error) {
            logger.error('Error generating embeddings:', error);
            throw error;
        }
    }

    async initialize() {
        if (!this.collection) {
            try {
                const params: GetCollectionParams = {
                    name: "scene_embeddings",
                    embeddingFunction: {
                        generate: (texts: (string | undefined)[]) => this.getEmbeddings(texts)
                    }
                };

                try {
                    this.collection = await this.client.getCollection(params);
                    logger.info('Successfully connected to existing ChromaDB collection');
                } catch (error) {
                    this.collection = await this.client.createCollection({
                        name: "scene_embeddings",
                        metadata: { 
                            "description": "Scene embeddings for similarity comparison" 
                        }
                    });
                    logger.info('Successfully created new ChromaDB collection');
                }
            } catch (error) {
                logger.error('Error initializing ChromaDB collection:', error);
                throw error;
            }
        }
    }

    async addScene(id: string, text: string, metadata?: Record<string, any>): Promise<void> {
        try {
            await this.initialize();
            
            if (!this.collection) {
                throw new Error('Collection not initialized');
            }

            const embedding = await this.getEmbedding(text);
            await this.collection.add({
                ids: [id],
                embeddings: [embedding],
                metadatas: [{ text, ...metadata }],
                documents: [text]
            });
            
            logger.info(`Successfully added scene ${id} to ChromaDB`);
        } catch (error) {
            logger.error(`Error adding scene ${id} to ChromaDB:`, error);
            throw error;
        }
    }

    async findSimilarScenes(text: string, limit: number = 5): Promise<{
        ids: string[];
        distances: number[];
        metadatas: Record<string, any>[];
        documents: string[];
    }> {
        try { 
            await this.initialize();
            
            if (!this.collection) {
                throw new Error('Collection not initialized');
            }

            const embedding = await this.getEmbedding(text);
            const results = await (this.collection as any).query({
                queryEmbeddings: [embedding],
                nResults: limit,
                include: ["metadatas", "distances", "documents"]
            });

            return {
                ids: results.ids[0] || [],
                distances: results.distances?.[0] || [],
                metadatas: (results.metadatas[0] || []).filter((metadata: unknown): metadata is Record<string, any> => 
                    metadata !== null && typeof metadata === 'object'
                ),
                documents: (results.documents[0] || []).filter((doc: unknown): doc is string => 
                    typeof doc === 'string'
                )
            };
        } catch (error) {
            logger.error(`Error querying similar scenes for text: ${text}`, error);
            throw error;
        }
    }

    async deleteScene(id: string): Promise<void> {
        try {
            await this.initialize();
            
            if (!this.collection) {
                throw new Error('Collection not initialized');
            }

            await this.collection.delete({
                ids: [id]
            });
            
            logger.info(`Successfully deleted scene ${id} from ChromaDB`);
        } catch (error) {
            logger.error(`Error deleting scene ${id} from ChromaDB:`, error);
            throw error;
        }
    }

    // Utility function to calculate cosine similarity between two vectors
    calculateSimilarity(vec1: number[], vec2: number[]): number {
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

    // Direct comparison between two texts
    async compareTexts(text1: string, text2: string): Promise<number> {
        const [embedding1, embedding2] = await Promise.all([
            this.getEmbedding(text1),
            this.getEmbedding(text2)
        ]);
        
        return this.calculateSimilarity(embedding1, embedding2);
    }
}

export const vectorStore = VectorStore.getInstance(); 