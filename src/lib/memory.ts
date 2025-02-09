import { prisma } from './prisma';
import { GameContext, SceneContext } from '../types/game';

export async function getAdventureMemory(adventureId: string): Promise<GameContext['memory']> {
    const recentScenes = await prisma.scene.findMany({
        where: { adventureId },
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    const defaultScene: SceneContext = {
        description: '',
        summary: '',
        keyEvents: [],
        npcInteractions: {},
        decisions: [],
        questProgress: {},
        locationContext: ''
    };

    const toSceneContext = (scene: any): SceneContext => ({
        description: scene.description,
        summary: scene.summary,
        keyEvents: scene.keyEvents,
        npcInteractions: scene.npcInteractions ? JSON.parse(scene.npcInteractions) : {},
        decisions: scene.decisions ? JSON.parse(scene.decisions) : [],
        questProgress: scene.questProgress ? JSON.parse(scene.questProgress) : {},
        locationContext: scene.locationContext || ''
    });

    return {
        currentScene: recentScenes[0] ? toSceneContext(recentScenes[0]) : defaultScene,
        recentScenes: recentScenes.slice(1).map(toSceneContext),
        significantMemories: [],
        activeQuests: [],
        knownCharacters: [],
        discoveredLocations: [],
        importantItems: []
    };
} 