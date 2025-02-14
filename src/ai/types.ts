import { WorldStyle, ToneStyle, MagicLevel } from '../shared/game/types';
import { Character } from '../features/character/types';

export interface AIResponse {
    text: string;
    suggestedActions?: string[];
    effects?: {
        health?: number;
        mana?: number;
        experience?: number;
        inventory?: {
            add?: string[];
            remove?: string[];
        };
    };
}

export interface AIContext {
    scene: string;
    playerActions: string[];
    characters: Character[];
    currentState: {
        health: number;
        mana: number;
        inventory: string[];
        questProgress: string;
    };
    language: string;
    adventureSettings: {
        worldStyle: WorldStyle;
        toneStyle: ToneStyle;
        magicLevel: MagicLevel;
        setting?: string;
    };
    memory: string[];
}

export interface AIService {
    generateResponse(context: AIContext): Promise<AIResponse>;
    generateCharacterBackground(characterName: string, race: string, characterClass: string): Promise<string>;
    generateAdventureSetting(worldStyle: WorldStyle, toneStyle: ToneStyle): Promise<string>;
} 