import axios from 'axios';

interface EmbeddingResponse {
    embedding: number[];
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

export async function getEmbedding(text: string): Promise<number[]> {
    try {
        const response = await axios.post<EmbeddingResponse>(`${OLLAMA_URL}/api/embeddings`, {
            model: EMBEDDING_MODEL,
            prompt: text
        });
        return response.data.embedding;
    } catch (error) {
        console.error('Error getting embedding:', error);
        throw error;
    }
}

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
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

export async function calculateVectorSimilarity(text1: string, text2: string): Promise<number> {
    const [embedding1, embedding2] = await Promise.all([
        getEmbedding(text1),
        getEmbedding(text2)
    ]);
    
    return cosineSimilarity(embedding1, embedding2);
}

interface ScenePurpose {
    hasProgression: boolean;
    hasConsequence: boolean;
    hasNewElement: boolean;
    purposeScore: number;
}

function evaluateScenePurpose(scene: string): ScenePurpose {
    // Check for story progression indicators
    const progressionKeywords = [
        'reveals', 'discovers', 'realizes', 'understands', 'notices',
        'revela', 'descobre', 'percebe', 'entende', 'nota',
        'becomes clear', 'appears to be', 'seems to be', 'indicates',
        'fica claro', 'parece ser', 'indica', 'demonstra',
        'shows signs of', 'exhibits', 'displays', 'manifests',
        'mostra sinais de', 'exibe', 'demonstra', 'manifesta',
        'intention is', 'purpose is', 'motive is', 'goal is',
        'intenção é', 'propósito é', 'motivo é', 'objetivo é'
    ];

    // Check for consequence indicators
    const consequenceKeywords = [
        'because', 'therefore', 'as a result', 'consequently',
        'porque', 'portanto', 'como resultado', 'consequentemente',
        'this means', 'indicating that', 'suggesting that', 'proving that',
        'isso significa', 'indicando que', 'sugerindo que', 'provando que',
        'revealing that', 'showing that', 'demonstrating that',
        'revelando que', 'mostrando que', 'demonstrando que'
    ];

    // Check for new element indicators
    const newElementKeywords = [
        'true nature', 'real purpose', 'actual intention', 'hidden motive',
        'verdadeira natureza', 'real propósito', 'real intenção', 'motivo oculto',
        'secret', 'mystery', 'truth', 'revelation',
        'segredo', 'mistério', 'verdade', 'revelação',
        'identity', 'origin', 'background', 'motivation',
        'identidade', 'origem', 'história', 'motivação'
    ];

    // Enhanced detection with context awareness using regex
    const hasProgression = progressionKeywords.some(keyword => 
        new RegExp(`\\b${keyword}\\b`, 'i').test(scene)
    ) || /\b(now|agora|then|então)\b.*\b(see|ver|understand|entender)\b/i.test(scene);

    const hasConsequence = consequenceKeywords.some(keyword => 
        new RegExp(`\\b${keyword}\\b`, 'i').test(scene)
    ) || /\b(because|porque|after|depois)\b.*\b(realize|perceber|notice|notar)\b/i.test(scene);

    const hasNewElement = newElementKeywords.some(keyword => 
        new RegExp(`\\b${keyword}\\b`, 'i').test(scene)
    ) || /\b(reveal|revelar|show|mostrar)\b.*\b(intention|intenção|purpose|propósito)\b/i.test(scene);

    // Weighted scoring with emphasis on revealing information when requested
    const purposeScore = (
        (hasProgression ? 0.4 : 0) +
        (hasConsequence ? 0.3 : 0) +
        (hasNewElement ? 0.3 : 0)
    );

    return {
        hasProgression,
        hasConsequence,
        hasNewElement,
        purposeScore
    };
}

export async function findMostSimilarScenes(newScene: string, recentScenes: string[]): Promise<{
    maxSimilarity: number;
    averageSimilarity: number;
    similarityMetrics: {
        tooSimilar: boolean;
        stagnating: boolean;
        tooDifferent: boolean;
        similarityScore: number;
        purpose: ScenePurpose;
        isValid: boolean;
    };
}> {
    if (recentScenes.length === 0) {
        const purpose = evaluateScenePurpose(newScene);
        return {
            maxSimilarity: 0,
            averageSimilarity: 0,
            similarityMetrics: {
                tooSimilar: false,
                stagnating: false,
                tooDifferent: false,
                similarityScore: 0,
                purpose,
                isValid: purpose.purposeScore >= 0.4 // Higher threshold for information revelation
            }
        };
    }

    const newSceneEmbedding = await getEmbedding(newScene);
    const sceneEmbeddings = await Promise.all(recentScenes.map(getEmbedding));
    
    const similarities = sceneEmbeddings.map(embedding => 
        cosineSimilarity(newSceneEmbedding, embedding)
    );

    const maxSimilarity = Math.max(...similarities);
    const averageSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    
    const purpose = evaluateScenePurpose(newScene);
    
    // Even stricter thresholds for observation/investigation actions
    const isObservationAction = /\b(observ|watch|look|see|understand|entend|olh|ver|perceb)\b/i.test(newScene);
    
    const similarityMetrics = {
        tooSimilar: maxSimilarity > (isObservationAction ? 0.80 : 0.85), // More lenient for observation
        stagnating: averageSimilarity > (isObservationAction ? 0.70 : 0.75), // More lenient for observation
        tooDifferent: maxSimilarity < 0.20,
        similarityScore: maxSimilarity,
        purpose,
        isValid: (
            purpose.purposeScore >= (isObservationAction ? 0.4 : 0.35) && // Higher purpose requirement for observation
            maxSimilarity <= (isObservationAction ? 0.80 : 0.85) &&
            maxSimilarity >= 0.20 &&
            averageSimilarity <= (isObservationAction ? 0.70 : 0.75)
        )
    };

    return {
        maxSimilarity,
        averageSimilarity,
        similarityMetrics
    };
} 