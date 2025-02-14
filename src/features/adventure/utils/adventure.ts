import { Adventure, GameContext, AdventureSettings } from '../types';
import { WorldStyles, ToneStyles, MagicLevels } from '../../../shared/types/game';

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
        adventureSettings: adventure.settings,
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
    if (!settings.worldStyle || !Object.values(WorldStyles).includes(settings.worldStyle)) {
        return false;
    }
    if (!settings.toneStyle || !Object.values(ToneStyles).includes(settings.toneStyle)) {
        return false;
    }
    if (!settings.magicLevel || !Object.values(MagicLevels).includes(settings.magicLevel)) {
        return false;
    }
    if (!settings.language) {
        return false;
    }
    return true;
}

export function generateAdventureDescription(context: GameContext): string {
    const { adventureSettings, characters } = context;
    return `A ${adventureSettings.worldStyle.toLowerCase()} adventure with a ${adventureSettings.toneStyle.toLowerCase()} tone. 
Players: ${characters.map(c => `${c.name} (${c.class})`).join(', ')}`;
} 