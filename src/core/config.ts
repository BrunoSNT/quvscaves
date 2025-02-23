import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

// Base configuration schema
const baseConfigSchema = z.object({
    // Discord
    DISCORD_TOKEN: z.string(),
    
    // Voice
    ELEVENLABS_API_KEY: z.string().optional(),
    
    // Database
    DATABASE_URL: z.string(),
    
    // Optional configs
    LOG_LEVEL: z.string().default('info'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Memory configuration
const memoryConfigSchema = z.object({
    exportPath: z.string().default('./data/exports'),
    similarityThreshold: z.number().default(0.8),
    cacheSize: z.number().default(1000),
    maxResults: z.number().default(5)
});

// Vector configuration
const vectorConfigSchema = z.object({
    chromaUrl: z.string().default('http://localhost:8000'),
    ollamaUrl: z.string().default('http://localhost:11434'),
    ollamaModel: z.string().default('qwen2.5:3b'),
    ollamaEmbeddingModel: z.string().default('nomic-embed-text')
});

// Knowledge configuration
const knowledgeConfigSchema = z.object({
    notionApiKey: z.string().optional(),
    notionDatabaseId: z.string().optional()
});

// Complete configuration schema
const configSchema = baseConfigSchema.extend({
    memory: memoryConfigSchema,
    vector: vectorConfigSchema,
    knowledge: knowledgeConfigSchema
});

export type Config = z.infer<typeof configSchema>;

function validateEnv(): Config {
    try {
        // Parse environment variables
        const baseConfig = baseConfigSchema.parse(process.env);

        // Parse memory config with default values
        const memory = {
            exportPath: process.env.MEMORY_EXPORT_PATH || './data/exports',
            similarityThreshold: Number(process.env.MEMORY_SIMILARITY_THRESHOLD || 0.8),
            cacheSize: Number(process.env.MEMORY_CACHE_SIZE || 1000),
            maxResults: Number(process.env.MEMORY_MAX_RESULTS || 5)
        };

        // Parse vector config with default values
        const vector = {
            chromaUrl: process.env.CHROMA_DB_URL || 'http://localhost:8000',
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
            ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'
        };

        // Parse knowledge config
        const knowledge = {
            notionApiKey: process.env.NOTION_API_KEY,
            notionDatabaseId: process.env.NOTION_DATABASE_ID
        };

        // Combine all configurations
        return configSchema.parse({
            ...baseConfig,
            memory,
            vector,
            knowledge
        });
    } catch (error) {
        console.error('Invalid configuration:', error);
        process.exit(1);
    }
}

export const config = validateEnv(); 