import { HybridAnalyzer, AnalyzerConfig } from './analyzer';
import { GameContext } from '../shared/game/types';
import { VectorStore } from '../core/vector/store';
import { logger } from '../shared/logger';
import { config } from '../core/config';
import axios from 'axios';
import { SkillCheck, DifficultyClass } from '../shared/game/skills';
import { formatGenericOutput } from '../shared/logger';

interface SkillAnalysis {
    requiresCheck: boolean;
    skill?: string;
    difficulty?: number;
    advantage?: boolean;
    disadvantage?: boolean;
    reasoning: string;
}

const SKILL_CHECK_PROMPT = `You are a D&D game master assistant analyzing player actions.

CONTEXT:
{context}

CHARACTER:
Name: {character_name}
Class: {character_class}
Level: {character_level}

ACTION:
"{action}"

Determine if this action requires a skill check by analyzing:
1. Risk and uncertainty involved
2. Required abilities or skills
3. Contextual difficulty (5-30)
4. Special conditions (advantage/disadvantage)

Respond in JSON format:
{
  "requiresCheck": boolean,
  "skill": string | null,
  "difficulty": number | null,
  "advantage": boolean,
  "disadvantage": boolean,
  "reasoning": string
}

Example response:
{
  "requiresCheck": true,
  "skill": "arcana",
  "difficulty": 15,
  "advantage": false,
  "disadvantage": false,
  "reasoning": "Attempting to decipher ancient magical runes requires arcana knowledge. Moderate difficulty due to age and complexity."
}`;

const CHECK_CATEGORIES = {
    athletics: ['climb', 'jump', 'swim', 'lift', 'run', 'push', 'pull'],
    stealth: ['sneak', 'hide', 'move silently', 'conceal'],
    persuasion: ['convince', 'persuade', 'negotiate', 'charm', 'diplomatic'],
    intimidation: ['threaten', 'intimidate', 'scare', 'menace'],
    investigation: ['search', 'examine', 'investigate', 'analyze', 'study'],
    perception: ['spot', 'notice', 'detect', 'observe', 'watch'],
    arcana: ['identify spell', 'magical knowledge', 'mystical', 'enchantment', 'cast spell', 'use magic', 'ritual'],
    acrobatics: ['balance', 'tumble', 'flip', 'roll', 'agile movement'],
    survival: ['track', 'forage', 'navigate', 'hunt', 'wilderness'],
    medicine: ['heal', 'treat wounds', 'diagnose', 'cure'],
    nature: ['animal handling', 'plant knowledge', 'weather', 'terrain'],
    religion: ['divine knowledge', 'ritual', 'ceremony', 'faith', 'prayer'],
    deception: ['lie', 'deceive', 'bluff', 'mislead', 'trick'],
    sleightOfHand: ['pickpocket', 'palm', 'manipulate', 'disable trap']
};

const NARRATIVE_CONTEXTS = {
    arcana: ['ancient', 'magical', 'mystical', 'arcane', 'spell', 'enchantment', 'sorcery', 'wizard', 'grimoire'],
    religion: ['divine', 'holy', 'sacred', 'ritual', 'prayer', 'blessing', 'temple', 'faith', 'gods'],
    investigation: ['clue', 'mystery', 'puzzle', 'hidden', 'secret', 'discover', 'uncover', 'reveal'],
    perception: ['notice', 'spot', 'detect', 'observe', 'sense', 'awareness', 'attention'],
    survival: ['wilderness', 'nature', 'track', 'hunt', 'forage', 'navigate', 'environment'],
    stealth: ['shadow', 'darkness', 'quiet', 'silent', 'unseen', 'hidden', 'concealed']
};

const RISK_LEVELS: Record<number, string[]> = {
    [DifficultyClass.VERY_EASY]: ['simple', 'basic', 'trivial', 'effortless'],
    [DifficultyClass.EASY]: ['easy', 'straightforward', 'clear', 'safe'],
    [DifficultyClass.MODERATE]: ['moderate', 'challenging', 'tricky', 'risky'],
    [DifficultyClass.HARD]: ['hard', 'difficult', 'dangerous', 'complex'],
    [DifficultyClass.VERY_HARD]: ['very hard', 'treacherous', 'perilous', 'intricate'],
    [DifficultyClass.NEARLY_IMPOSSIBLE]: ['impossible', 'deadly', 'extreme', 'masterful']
};

export class SkillCheckAnalyzer extends HybridAnalyzer<SkillCheck> {
    private static instance: SkillCheckAnalyzer;

    private constructor(adventureId: string) {
        const config: AnalyzerConfig = {
            embeddings: {
                concepts: Object.values(CHECK_CATEGORIES).flat(),
                confidenceThreshold: 0.8
            },
            llm: {
                systemPrompt: `You are a D&D game master assistant analyzing player actions.

Determine if actions require skill checks by analyzing:
1. Risk and uncertainty involved
2. Required abilities or skills
3. Contextual difficulty (5-30)
4. Special conditions (advantage/disadvantage)

Respond in JSON format:
{
  "requiresCheck": boolean,
  "skill": string | null,
  "difficulty": number | null,
  "advantage": boolean,
  "disadvantage": boolean,
  "reasoning": string
}`,
                temperature: 0.7
            }
        };
        super(adventureId, config);
    }

    public static getInstance(adventureId: string): SkillCheckAnalyzer {
        if (!SkillCheckAnalyzer.instance) {
            SkillCheckAnalyzer.instance = new SkillCheckAnalyzer(adventureId);
        }
        return SkillCheckAnalyzer.instance;
    }

    protected async generateQuickResult(
        action: string,
        context: GameContext,
        confidence: number
    ): Promise<SkillCheck | null> {
        const narrativeContext = context.additionalContext?.join(' ') || '';
        const fullContext = `${narrativeContext} ${action}`.toLowerCase();

        // First check if this is a type of action that should require a check
        const requiresCheck = await this.shouldRequireCheck(action, fullContext);
        if (!requiresCheck) {
            return null;
        }

        // Determine skill
        let bestSkill = null;
        let highestSimilarity = 0;

        for (const [skill, keywords] of Object.entries(CHECK_CATEGORIES)) {
            const { similarity } = await this.vectorStore.compareWithConcepts(action.toLowerCase(), keywords);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestSkill = skill;
            }
        }

        if (!bestSkill) return null;

        // Calculate difficulty
        let difficulty = DifficultyClass.MODERATE;
        for (const [dc, keywords] of Object.entries(RISK_LEVELS)) {
            if (keywords.some(keyword => fullContext.includes(keyword))) {
                difficulty = Number(dc);
                break;
            }
        }

        return {
            skill: bestSkill,
            difficulty,
            advantage: false,
            disadvantage: false
        };
    }

    private async shouldRequireCheck(action: string, context: string): Promise<boolean> {
        // Define actions that typically don't need checks
        const simpleActions = [
            'talk', 'speak', 'ask', 'say', 'tell', 'greet', 'contact',
            'look', 'watch', 'observe', 'listen',
            'walk', 'move', 'go', 'approach',
            'wait', 'rest', 'sit', 'stand'
        ];

        // Check if this is a simple action
        const isSimpleAction = simpleActions.some(simple => 
            action.toLowerCase().includes(simple)
        );

        if (isSimpleAction) {
            // Check if there are any complicating factors
            const complicatingFactors = [
                'stealthily', 'carefully', 'secretly', 'without being seen',
                'difficult', 'challenging', 'risky', 'dangerous',
                'complex', 'complicated', 'intricate',
                'quickly', 'rapidly', 'fast', 'hurry',
                'while', 'during', 'as'
            ];

            const hasComplication = complicatingFactors.some(factor => 
                context.includes(factor)
            );

            return hasComplication;
        }

        // For non-simple actions, check if they're challenging enough to warrant a roll
        const challengingConcepts = [
            'force', 'break', 'climb', 'jump', 'swim',
            'steal', 'pick lock', 'disable', 'trap',
            'convince', 'persuade', 'intimidate', 'deceive',
            'recall', 'remember', 'knowledge', 'identify',
            'track', 'hunt', 'find', 'locate'
        ];

        const { similarity } = await this.vectorStore.compareWithConcepts(
            action.toLowerCase(),
            challengingConcepts
        );

        return similarity > 0.6;
    }

    protected buildLLMPrompt(action: string, context: GameContext): string {
        const character = context.characters[0];
        const narrativeContext = context.additionalContext?.join('\n') || '';

        return `<|im_start|>system
${this.config.llm.systemPrompt}

CONTEXT:
${narrativeContext}

CHARACTER:
Name: ${character?.name}
Class: ${character?.class}
Level: ${character?.level}

ACTION:
"${action}"
<|im_end|>
<|im_start|>user
Analyze this action for required skill checks.
<|im_end|>
<|im_start|>assistant`;
    }

    protected parseLLMResponse(response: string): SkillCheck | null {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const analysis = JSON.parse(jsonMatch[0]);
            
            if (!analysis.requiresCheck) {
                return null;
            }

            return {
                skill: analysis.skill || 'perception',
                difficulty: analysis.difficulty || DifficultyClass.MODERATE,
                advantage: analysis.advantage || false,
                disadvantage: analysis.disadvantage || false
            };
        } catch (error) {
            logger.error('Error parsing LLM response:' + formatGenericOutput(JSON.stringify(error)));
            return null;
        }
    }
} 