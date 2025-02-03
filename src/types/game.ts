export type SupportedLanguage = 'en-US' | 'pt-BR';

export interface GameContext {
    scene: string;
    playerActions: string[];
    characters: any[];
    currentState: {
        health: number;
        mana: number;
        inventory: string[];
        questProgress: string;
    };
    language: SupportedLanguage;
} 