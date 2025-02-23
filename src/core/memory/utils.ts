import { EpisodicMemory, SemanticMemory, WorkingMemory } from './types';
import { VectorStore } from '../vector/store';
import { logger } from '../../shared/logger';
import * as fs from 'fs';
import * as path from 'path';

export async function exportMemoriesToJsonl(adventureId: string, memories: EpisodicMemory[]): Promise<string> {
    const exportDir = path.join(process.cwd(), 'data', 'exports', adventureId);
    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }

    const filename = `memories_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    const filepath = path.join(exportDir, filename);

    try {
        const lines = memories.map(memory => JSON.stringify({
            type: memory.type,
            content: memory.content,
            timestamp: memory.timestamp.toISOString(),
            metadata: memory.metadata
        }));

        fs.writeFileSync(filepath, lines.join('\n'));
        logger.info(`Exported ${memories.length} memories to ${filepath}`);
        return filepath;
    } catch (error) {
        logger.error('Error exporting memories:', error);
        throw error;
    }
}

export async function findSimilarMemories(
    content: string,
    memories: (EpisodicMemory | SemanticMemory)[],
    threshold: number = 0.8,
    limit: number = 5
): Promise<(EpisodicMemory | SemanticMemory)[]> {
    const vectorStore = VectorStore.getInstance();
    const results: (EpisodicMemory | SemanticMemory)[] = [];

    try {
        const contentEmbedding = await vectorStore.getEmbedding(content);

        for (const memory of memories) {
            if (!memory.embedding) {
                memory.embedding = await vectorStore.getEmbedding(memory.content);
            }

            const similarity = vectorStore.calculateSimilarity(contentEmbedding, memory.embedding);
            if (similarity >= threshold) {
                results.push(memory);
            }
        }

        return results
            .sort((a, b) => {
                const aEmbedding = a.embedding || [];
                const bEmbedding = b.embedding || [];
                const aSimilarity = vectorStore.calculateSimilarity(contentEmbedding, aEmbedding);
                const bSimilarity = vectorStore.calculateSimilarity(contentEmbedding, bEmbedding);
                return bSimilarity - aSimilarity;
            })
            .slice(0, limit);
    } catch (error) {
        logger.error('Error finding similar memories:', error);
        throw error;
    }
}

export function mergeWorkingMemories(memories: WorkingMemory[]): WorkingMemory {
    return {
        promptStructure: memories[0]?.promptStructure || '',
        availableTools: Array.from(new Set(memories.flatMap(m => m.availableTools))),
        additionalContext: Array.from(new Set(memories.flatMap(m => m.additionalContext))),
        reasoningHistory: memories
            .flatMap(m => m.reasoningHistory)
            .sort((a, b) => a.localeCompare(b))
            .filter((item, index, array) => array.indexOf(item) === index)
    };
}

export function summarizeMemories(memories: (EpisodicMemory | SemanticMemory)[]): string {
    const groups = memories.reduce((acc, memory) => {
        const type = memory.type;
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(memory);
        return acc;
    }, {} as Record<string, (EpisodicMemory | SemanticMemory)[]>);

    const summary = Object.entries(groups)
        .map(([type, typeMemories]) => {
            const count = typeMemories.length;
            const latest = typeMemories
                .sort((a, b) => {
                    const aTime = 'timestamp' in a ? a.timestamp : new Date(0);
                    const bTime = 'timestamp' in b ? b.timestamp : new Date(0);
                    return bTime.getTime() - aTime.getTime();
                })
                .slice(0, 3);

            return `${type} (${count} total):\n${latest
                .map(m => `- ${m.content.substring(0, 100)}...`)
                .join('\n')}`;
        })
        .join('\n\n');

    return summary;
} 