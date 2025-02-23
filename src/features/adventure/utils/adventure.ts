import { Adventure, AdventureSettings } from '../types';
import { WorldStyle, ToneStyle, MagicLevel, GameContext } from '../../../shared/game/types';

// Moving content from src/utils/adventure.ts
export function formatAdventureContext(adventure: Adventure): GameContext {
    return {
        adventure,
        scene: adventure.description || '',
        characters: adventure.players
            .filter(p => p.character)
            .map(p => p.character!),
        playerActions: [],
        currentState: {
            health: 100,
            mana: 100,
            inventory: [],
            questProgress: ''
        },
        language: adventure.settings.language || 'en-US',
        memory: {
            recentScenes: [],
            activeQuests: [],
            knownCharacters: [],
            discoveredLocations: [],
            importantItems: []
        }
    };
}
export function validateAdventureSettings(settings: Partial<AdventureSettings>): boolean {
    if (!settings.worldStyle || !Object.values(WorldStyle).includes(settings.worldStyle)) {
        return false;
    }
    if (!settings.toneStyle || !Object.values(ToneStyle).includes(settings.toneStyle)) {
        return false;
    }
    if (!settings.magicLevel || !Object.values(MagicLevel).includes(settings.magicLevel)) {
        return false;
    }
    if (!settings.language) {
        return false;
    }
    return true;
}

export function generateAdventureDescription(context: GameContext): string {
    const { adventure, characters } = context;
    return `A ${adventure?.worldStyle.toLowerCase()} adventure with a ${adventure?.toneStyle.toLowerCase()} tone. 
Players: ${characters.map((c: { name: any; class: any; }) => `${c.name} (${c.class})`).join(', ')}`;
} 