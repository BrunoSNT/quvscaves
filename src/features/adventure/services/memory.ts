import { prisma } from '../../../core/prisma';
import { logger } from '../../../shared/logger';
import { vectorStore } from '../../../shared/game/vector';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

interface Node {
    id: string;
    label: string;
    title?: string;
    group?: string;
    shape?: string;
    color?: {
        background?: string;
        border?: string;
    };
    font?: {
        multi?: boolean;
        size?: number;
        face?: string;
    };
}

interface Edge {
    source: string;
    target: string;
    arrows?: string;
    dashes?: boolean;
    label?: string;
    color?: string;
    font?: {
        size?: number;
        align?: string;
        color?: string;
    };
}

interface GraphData {
    nodes: Node[];
    edges: Edge[];
}

export class MemoryService {
    private static getVisualizationPath(adventureId: string): string {
        const visualizationDir = path.join(process.cwd(), 'visualizations');
        if (!fs.existsSync(visualizationDir)) {
            fs.mkdirSync(visualizationDir, { recursive: true });
        }
        return path.join(visualizationDir, `adventure_${adventureId}.html`);
    }

    private static getVectorDataPath(adventureId: string): { vectors: string; metadata: string } {
        const dataDir = path.join(process.cwd(), 'data', 'vectors');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        return {
            vectors: path.join(dataDir, `adventure_${adventureId}_vectors.tsv`),
            metadata: path.join(dataDir, `adventure_${adventureId}_metadata.tsv`)
        };
    }

    private async updateVisualization(adventureId: string, memories: any[]): Promise<void> {
        const nodes: Node[] = [];
        const edges: Edge[] = [];
        const addedNodes = new Set<string>();

        // Process memories in chronological order
        const sortedMemories = [...memories].sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        // First pass: Create all nodes and collect embeddings
        const embeddings: number[][] = [];
        const metadataRows: string[] = ['Title\tType\tDescription'];

        for (const memory of sortedMemories) {
            try {
                // Get embedding directly from Ollama API
                const response = await axios.post(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/embeddings`, {
                    model: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
                    prompt: memory.description
                });

                if (response.data.embedding) {
                    embeddings.push(response.data.embedding);
                    
                    // Add metadata
                    metadataRows.push(`${memory.title}\t${memory.type}\t${memory.description.replace(/\t/g, ' ')}`);

                    if (!addedNodes.has(memory.id)) {
                        const node: Node = {
                            id: memory.id,
                            label: memory.title,
                            title: `${memory.title}\n\n${memory.description}`,
                            shape: 'circle',
                            color: { 
                                background: memory.type === 'SCENE' ? '#97C2FC' : 
                                          memory.type === 'QUEST' ? '#FFB366' : 
                                          memory.type === 'ITEM' ? '#99FF99' : '#E6E6E6',
                                border: memory.type === 'SCENE' ? '#2B7CE9' : 
                                        memory.type === 'QUEST' ? '#FF9933' : 
                                        memory.type === 'ITEM' ? '#33CC33' : '#999999'
                            }
                        };
                        nodes.push(node);
                        addedNodes.add(memory.id);
                    }
                }
            } catch (error) {
                logger.error(`Error getting embedding for memory ${memory.id}:`, error);
            }
        }

        // Save embeddings and metadata to TSV files
        const paths = MemoryService.getVectorDataPath(adventureId);
        
        // Save vectors
        const vectorRows = embeddings.map(embedding => embedding.join('\t'));
        fs.writeFileSync(paths.vectors, vectorRows.join('\n'));
        logger.info(`Saved ${embeddings.length} vectors to ${paths.vectors}`);

        // Save metadata
        fs.writeFileSync(paths.metadata, metadataRows.join('\n'));
        logger.info(`Saved metadata for ${metadataRows.length - 1} memories to ${paths.metadata}`);

        // Continue with graph visualization...
        // Second pass: Create edges
        let previousMemory = null;
        for (const memory of sortedMemories) {
            // Connect sequential scenes
            if (previousMemory && addedNodes.has(previousMemory.id) && addedNodes.has(memory.id)) {
                edges.push({
                    source: previousMemory.id,
                    target: memory.id,
                    arrows: 'to',
                    label: memory.metadata?.selectedAction || '',
                    color: '#333333'
                });
            }

            if (memory.metadata) {
                // Connect to explicitly referenced previous scene if it exists
                if (memory.metadata.previousMemoryId && 
                    addedNodes.has(memory.metadata.previousMemoryId) && 
                    memory.metadata.previousMemoryId !== previousMemory?.id) {
                    edges.push({
                        source: memory.metadata.previousMemoryId,
                        target: memory.id,
                        arrows: 'to',
                        label: memory.metadata.selectedAction || '',
                        color: '#333333',
                        dashes: true
                    });
                }

                // Add non-selected action nodes
                if (memory.metadata.availableActions) {
                    memory.metadata.availableActions.forEach((action: string) => {
                        if (action !== memory.metadata.selectedAction) {
                            const alternateId = `${memory.id}_${action.replace(/\s+/g, '_')}`;
                            if (!addedNodes.has(alternateId)) {
                                nodes.push({
                                    id: alternateId,
                                    label: action,
                                    title: `Alternative Action:\n${action}`,
                                    shape: 'circle',
                                    color: { 
                                        background: '#E6E6E6', 
                                        border: '#999999' 
                                    }
                                });
                                addedNodes.add(alternateId);
                            }
                            edges.push({
                                source: memory.id,
                                target: alternateId,
                                arrows: 'to',
                                color: '#999999',
                                dashes: true
                            });
                        }
                    });
                }

                // Add quest and item connections
                if (memory.metadata.quest_related || memory.metadata.key_item) {
                    const relatedMemories = await this.findRelatedMemories(adventureId, memory);
                    for (const related of relatedMemories) {
                        if (addedNodes.has(related.id) && related.id !== memory.id) {
                            edges.push({
                                source: memory.id,
                                target: related.id,
                                arrows: 'to,from',
                                color: '#333333',
                                dashes: true
                            });
                        }
                    }
                }
            }

            previousMemory = memory;
        }

        const graphData: GraphData = { nodes, edges };
        const visualizationPath = MemoryService.getVisualizationPath(adventureId);
        
        const html = this.generateVisualizationHtml(graphData);
        fs.writeFileSync(visualizationPath, html);
    }

    private generateVisualizationHtml(graphData: GraphData): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Adventure Memory Graph</title>
    <script src="https://gw.alipayobjects.com/os/lib/antv/g6/4.8.24/dist/g6.min.js"></script>
    <style type="text/css">
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        #container {
            width: 100%;
            height: 100%;
            background: #ffffff;
        }
    </style>
</head>
<body>
    <div id="container"></div>
    <script type="text/javascript">
        const container = document.getElementById('container');
        const width = container.scrollWidth;
        const height = container.scrollHeight || 800;

        const data = {
            nodes: ${JSON.stringify(graphData.nodes)}.map(node => ({
                id: node.id,
                label: node.label,
                title: node.title,
                type: 'circle',
                size: node.id.includes('_') ? 30 : 40,
                style: {
                    fill: node.color?.background || '#97C2FC',
                    stroke: node.color?.border || '#2B7CE9',
                    lineWidth: node.id.includes('_') ? 1 : 2,
                    opacity: node.id.includes('_') ? 0.7 : 1
                },
                labelCfg: {
                    style: {
                        fill: node.id.includes('_') ? '#666666' : '#333333',
                        fontSize: node.id.includes('_') ? 10 : 12,
                        opacity: node.id.includes('_') ? 0.8 : 1
                    },
                    position: 'bottom'
                }
            })),
            edges: ${JSON.stringify(graphData.edges)}.map(edge => ({
                source: edge.source,
                target: edge.target,
                label: edge.label,
                style: {
                    stroke: edge.color || '#333333',
                    lineWidth: edge.target.includes('_') ? 1 : 1.5,
                    opacity: edge.target.includes('_') ? 0.5 : 1,
                    endArrow: true,
                    startArrow: edge.arrows === 'to,from',
                    lineDash: edge.dashes ? [5, 5] : null
                }
            }))
        };

        const graph = new G6.Graph({
            container: 'container',
            width,
            height,
            fitView: true,
            fitViewPadding: 50,
            animate: true,
            modes: {
                default: ['drag-canvas', 'zoom-canvas', 'drag-node', 'click-select']
            },
            layout: {
                type: 'force',
                preventOverlap: true,
                linkDistance: 150,
                nodeStrength: -50,
                edgeStrength: 0.5,
                collideStrength: 0.5,
                alphaDecay: 0.01,
                alpha: 0.3,
                iterations: 500
            },
            defaultNode: {
                type: 'circle',
                size: 40,
                style: {
                    fill: '#97C2FC',
                    stroke: '#2B7CE9',
                    lineWidth: 2
                },
                labelCfg: {
                    position: 'bottom',
                    offset: 10,
                    style: {
                        fill: '#333333',
                        fontSize: 12
                    }
                }
            },
            defaultEdge: {
                type: 'line',
                style: {
                    stroke: '#333333',
                    lineWidth: 1.5,
                    endArrow: true,
                    radius: 20
                },
                labelCfg: {
                    autoRotate: true,
                    style: {
                        fill: '#666666',
                        fontSize: 10
                    }
                }
            }
        });

        // Register node and edge behaviors
        graph.on('node:mouseenter', (evt) => {
            const { item } = evt;
            graph.setItemState(item, 'hover', true);
        });

        graph.on('node:mouseleave', (evt) => {
            const { item } = evt;
            graph.setItemState(item, 'hover', false);
        });

        graph.on('edge:mouseenter', (evt) => {
            const { item } = evt;
            graph.setItemState(item, 'hover', true);
        });

        graph.on('edge:mouseleave', (evt) => {
            const { item } = evt;
            graph.setItemState(item, 'hover', false);
        });

        // Data and render
        graph.data(data);
        graph.render();

        // Fit view after layout
        graph.on('afterlayout', () => {
            graph.fitView();
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (!graph || graph.get('destroyed')) return;
            const container = document.getElementById('container');
            if (!container) return;
            graph.changeSize(container.scrollWidth, container.scrollHeight);
            graph.fitView();
        });

        // Initial fit view
        setTimeout(() => {
            graph.fitView();
        }, 100);
    </script>
</body>
</html>`;
    }

    private async findRelatedMemories(adventureId: string, memory: any) {
        return prisma.memory.findMany({
            where: {
                adventureId,
                OR: [
                    { type: memory.type },
                    { title: { contains: memory.title } }
                ]
            }
        });
    }

    async getVisualizationUrl(adventureId: string): Promise<{ graph: string; vectors: string; metadata: string }> {
        const memories = await this.getMemories(adventureId);
        await this.updateVisualization(adventureId, memories);
        
        const paths = MemoryService.getVectorDataPath(adventureId);
        return {
            graph: MemoryService.getVisualizationPath(adventureId),
            vectors: paths.vectors,
            metadata: paths.metadata
        };
    }

    async createMemory(
        adventureId: string,
        title: string,
        description: string,
        type: string,
        metadata?: Record<string, any>
    ) {
        const memory = await prisma.memory.create({
            data: {
                adventureId,
                title,
                description,
                type,
                metadata
            }
        });

        try {
            // Store the memory in vector store directly
            await vectorStore.addScene(memory.id, description, metadata);
            logger.info(`Stored memory ${memory.id} in vector store`);
        } catch (error) {
            logger.error('Error storing memory in vector store:', error);
        }

        return memory;
    }

    async getMemories(adventureId: string) {
        return prisma.memory.findMany({
            where: {
                adventureId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }

    async getMemory(id: string) {
        return prisma.memory.findUnique({
            where: {
                id
            }
        });
    }

    async updateMemory(
        id: string,
        data: any
    ) {
        return prisma.memory.update({
            where: {
                id
            },
            data
        });
    }

    async deleteMemory(id: string) {
        await prisma.memory.delete({
            where: {
                id
            }
        });
    }

    async searchMemories(
        adventureId: string,
        searchTerm: string
    ) {
        try {
            // Search for similar memories in the vector store
            const similarMemories = await vectorStore.findSimilarScenes(searchTerm);
            logger.info(`Found ${similarMemories.documents.length} similar memories for search term: ${searchTerm}`);
            
            // Filter to only memories for the current adventure
            const filteredMemories = similarMemories.documents.filter((_, index) => 
                similarMemories.metadatas[index].adventureId === adventureId
            );
            
            return filteredMemories;
        } catch (error) {
            logger.error('Error searching memories in vector store:', error);
            return []; 
        }
    }
} 