import { MemoryManager, EpisodicMemoryInput } from '../core/memory/types';
import { EpisodicMemoryManagerImpl } from '../core/memory/episodic';
import { SemanticMemoryManagerImpl } from '../core/memory/semantic';
import { WorkingMemoryManagerImpl } from '../core/memory/working';
import { ProceduralMemoryManagerImpl } from '../core/memory/procedural';
import { GameContext } from '../shared/game/types';
import { logger } from '../shared/logger';
import { config } from '../core/config';
import { deduplicateMemories } from '../features/adventure/utils/memory';
import { VectorStore } from '../core/vector/store';
import crypto from 'crypto';

export class Orchestrator {
    private memoryManager: MemoryManager;
    private adventureId: string;
    private lastMemoryTimestamp: Date;
    private workingMemory: {
        promptStructure?: string;
        availableTools?: any[];
        additionalContext?: string[];
        reasoningHistory?: string[];
        currentContext?: GameContext;
    } = {};

    constructor(adventureId: string, notionConfig?: { apiKey: string; databaseId: string }) {
        this.adventureId = adventureId;
        this.lastMemoryTimestamp = new Date(0); // Initialize to past date
        this.memoryManager = {
            episodic: new EpisodicMemoryManagerImpl(adventureId),
            semantic: new SemanticMemoryManagerImpl(notionConfig || {
                apiKey: config.knowledge.notionApiKey || '',
                databaseId: config.knowledge.notionDatabaseId || ''
            }),
            working: new WorkingMemoryManagerImpl(),
            procedural: new ProceduralMemoryManagerImpl()
        };
    }

    async processInput(input: string, context: GameContext): Promise<void> {
        try {
            // Store the input as a scene memory
            const vectorStore = VectorStore.getInstance();
            try {
                const vector = await vectorStore.getEmbedding(input);
                await vectorStore.addEntry({
                    id: crypto.randomUUID(),
                    vector,
                    metadata: {
                        type: 'action',
                        content: input,
                        timestamp: new Date(),
                        adventureId: this.adventureId,
                        characterId: context.characters[0]?.id
                    }
                });
            } catch (error) {
                logger.warn('Failed to store input in vector store:', error);
                // Continue even if vector store fails
            }

            // Update context with new memory
            if (!context.memory) {
                context.memory = {
                    recentScenes: [],
                    activeQuests: [],
                    knownCharacters: [],
                    discoveredLocations: [],
                    importantItems: []
                };
            }

            // Add to recent scenes
            context.memory.recentScenes.unshift({
                summary: input,
                timestamp: new Date(),
                type: 'action'
            });

            // Keep only last 5 scenes
            context.memory.recentScenes = context.memory.recentScenes.slice(0, 5);

            // Update working memory
            this.workingMemory.currentContext = context;

            logger.debug('Successfully stored human memory');
        } catch (error) {
            logger.error('Error storing human memory:', error);
            throw error;
        }
    }

    async getEnhancedContext(context: GameContext): Promise<GameContext> {
        try {
            // 1. Get available tools and prompts
            const [tools, prompts] = await Promise.all([
                this.memoryManager.procedural.getTools(),
                this.memoryManager.procedural.getPrompts()
            ]);

            // 2. Update working memory with tools and prompts
            this.memoryManager.working.update({
                availableTools: tools.map(t => t.name),
                promptStructure: prompts[0]?.description || ''
            });

            // 3. Get recent episodic memories
            const recentMemories = await this.memoryManager.episodic.getRecent(
                config.memory.maxResults
            );

            // 4. Get recent reasoning history
            const recentReasoning = this.memoryManager.working.getRecentReasoning(
                config.memory.maxResults
            );

            // 5. Return enhanced context
            return {
                ...context,
                additionalContext: recentMemories.map(m => m.content),
                availableTools: tools.map(t => ({ name: t.name, description: t.description })),
                reasoning: recentReasoning
            };
        } catch (error) {
            logger.error('Error getting enhanced context:', error);
            throw error;
        }
    }

    async storeResponse(response: string, context: GameContext): Promise<void> {
        try {
            // Parse the response to get all text content
            let narration: string = '';
            let worldContext: string = '';
            let atmosphere: string = '';
            
            try {
                logger.debug('Parsing response JSON...');
                const parsed = JSON.parse(response);
                narration = parsed.narration || parsed.narracao || '';
                worldContext = parsed.world_context || parsed.contexto_mundo || '';
                atmosphere = parsed.atmosphere || parsed.atmosfera || '';

                logger.debug('Extracted text content: ' + {
                    narrationLength: narration.length,
                    worldContextLength: worldContext.length,
                    atmosphereLength: atmosphere.length
                });
            } catch (parseError) {
                logger.warn('Failed to parse response JSON, using raw response: ' + parseError);
                narration = response;
            }

            // Store all text components together for better performance
            const vectorStore = VectorStore.getInstance();
            try {
                // Combine all text components with markers
                const combinedText = [
                    worldContext ? `[WORLD_CONTEXT] ${worldContext}` : '',
                    narration ? `[NARRATION] ${narration}` : '',
                    atmosphere ? `[ATMOSPHERE] ${atmosphere}` : ''
                ].filter(Boolean).join('\n\n');

                if (combinedText) {
                    logger.debug('Storing combined text in vector store: ' + {
                        totalLength: combinedText.length,
                        components: {
                            worldContext: worldContext ? 'present' : 'absent',
                            narration: narration ? 'present' : 'absent',
                            atmosphere: atmosphere ? 'present' : 'absent'
                        }
                    });

                    const vector = await vectorStore.getEmbedding(combinedText);
                    await vectorStore.addEntry({
                        id: crypto.randomUUID(),
                        vector,
                        metadata: {
                            type: 'scene',
                            content: combinedText,
                            timestamp: new Date(),
                            adventureId: this.adventureId,
                            characterId: context.characters[0]?.id
                        }
                    });
                    logger.debug('Successfully stored text in vector store');
                }
            } catch (error) {
                logger.warn('Failed to store response in vector store:', error);
                // Continue even if vector store fails
            }

            // Update context with new memory
            if (!context.memory) {
                context.memory = {
                    recentScenes: [],
                    activeQuests: [],
                    knownCharacters: [],
                    discoveredLocations: [],
                    importantItems: []
                };
            }

            // Add all components to recent scenes in a single entry
            const timestamp = new Date();
            const sceneEntry = {
                summary: [
                    worldContext && `World Context: ${worldContext}`,
                    narration && `Narration: ${narration}`,
                    atmosphere && `Atmosphere: ${atmosphere}`
                ].filter(Boolean).join('\n\n'),
                timestamp,
                type: 'scene'
            };

            logger.debug('Adding scene entry to memory: ' + {
                timestamp: timestamp.toISOString(),
                summaryLength: sceneEntry.summary.length
            });

            context.memory.recentScenes.unshift(sceneEntry);

            // Keep only last 5 scenes
            context.memory.recentScenes = context.memory.recentScenes.slice(0, 5);

            // Update working memory
            this.workingMemory.currentContext = context;

            logger.debug('Successfully stored scene memory');
        } catch (error) {
            logger.error('Error storing scene memory:', error);
            throw error;
        }
    }

    async syncKnowledge(): Promise<void> {
        try {
            await (this.memoryManager.semantic as SemanticMemoryManagerImpl).syncWithNotion();
            logger.info('Successfully synced knowledge base');
        } catch (error) {
            logger.error('Error syncing knowledge base:', error);
            throw error;
        }
    }

    getWorkingMemory() {
        return this.memoryManager.working.get();
    }

    clearWorkingMemory() {
        this.memoryManager.working.clear();
    }
} 