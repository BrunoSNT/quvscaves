import { Memory } from '@prisma/client';

interface MemoryScore {
    memory: Memory;
    score: number;
}

// Calculate time decay factor (more recent = higher score)
function calculateTimeDecay(timestamp: Date): number {
    const now = new Date();
    const ageInHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
    return Math.exp(-ageInHours / 24); // Exponential decay over 24 hours
}

// Calculate importance based on memory type and metadata
function calculateImportance(memory: Memory): number {
    const typeWeights: { [key: string]: number } = {
        'SCENE': 1.0,
        'QUEST': 1.5,
        'CHARACTER': 1.2,
        'LOCATION': 1.1,
        'ITEM': 0.9
    };

    const baseScore = typeWeights[memory.type] || 1.0;
    
    // Parse metadata for additional importance factors
    const metadata = memory.metadata as any;
    let metadataScore = 0;

    if (metadata) {
        // Score based on presence of key elements
        if (metadata.combat) metadataScore += 0.3;
        if (metadata.discovery) metadataScore += 0.2;
        if (metadata.interaction) metadataScore += 0.2;
        if (metadata.quest_related) metadataScore += 0.4;
        if (metadata.key_item) metadataScore += 0.3;
    }

    return baseScore + metadataScore;
}

// Calculate narrative relevance based on text similarity
function calculateNarrativeRelevance(memory: Memory, currentAction: string): number {
    // Simple keyword-based relevance for now
    // This could be enhanced with actual embedding similarity once we add that
    const keywords = currentAction.toLowerCase().split(' ');
    const memoryText = (memory.description + ' ' + memory.title).toLowerCase();
    
    const relevanceScore = keywords.reduce((score, keyword) => {
        return score + (memoryText.includes(keyword) ? 0.2 : 0);
    }, 0);

    return Math.min(relevanceScore, 1);
}

export function rankMemories(memories: Memory[], currentAction: string): Memory[] {
    // Score each memory based on multiple factors
    const scoredMemories: MemoryScore[] = memories.map(memory => {
        const timeScore = calculateTimeDecay(memory.createdAt);
        const importanceScore = calculateImportance(memory);
        const relevanceScore = calculateNarrativeRelevance(memory, currentAction);

        // Combine scores with weights
        const finalScore = (
            timeScore * 0.4 +          // 40% weight for recency
            importanceScore * 0.3 +    // 30% weight for importance
            relevanceScore * 0.3       // 30% weight for relevance
        );

        return {
            memory,
            score: finalScore
        };
    });

    // Sort by score and return memories
    return scoredMemories
        .sort((a, b) => b.score - a.score)
        .map(scored => scored.memory);
}

// Function to deduplicate similar memories
export function deduplicateMemories(memories: Memory[]): Memory[] {
    const uniqueMemories: Memory[] = [];
    const seenDescriptions = new Set<string>();

    for (const memory of memories) {
        // Create a simplified version of the description for comparison
        const simplifiedDesc = memory.description.toLowerCase().trim();
        
        // Skip if we've seen a very similar description
        if (seenDescriptions.has(simplifiedDesc)) {
            continue;
        }

        // Check for similar descriptions using Levenshtein distance or other similarity metrics
        const isSimilarToExisting = Array.from(seenDescriptions).some(desc => {
            return calculateSimilarity(desc, simplifiedDesc) > 0.8; // 80% similarity threshold
        });

        if (!isSimilarToExisting) {
            seenDescriptions.add(simplifiedDesc);
            uniqueMemories.push(memory);
        }
    }

    return uniqueMemories;
}

// Helper function to calculate text similarity
function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
        return 1.0;
    }
    
    // Calculate Levenshtein distance
    const costs: number[] = [];
    for (let i = 0; i <= shorter.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= longer.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (shorter.charAt(i - 1) !== longer.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[longer.length] = lastValue;
        }
    }
    
    return (longer.length - costs[shorter.length]) / longer.length;
} 