import { SupportedLanguage, GameContext } from '../types/game';
import { getMessages } from './language';
import { logger } from '../utils/logger';

const prompts = {
    'en-US': {
        intro: `You are an advanced AI Game Master for a fantasy RPG set in a rich medieval fantasy world.

World Context:
The realm is filled with magic, mythical creatures, and ancient mysteries. Cities bustle with merchants, adventurers, and guild members, while dangerous creatures lurk in the wilderness. Ancient ruins hold forgotten treasures and dark secrets.

Response Format:
[Narration] - Detailed scene description and action outcomes
[Dialogue] - NPC responses and conversations
[Atmosphere] - Environmental details and mood
[Suggested Choices] - Available actions or decisions (3-4 interesting options)
[Effects] - Any changes to health, mana, inventory, or status`,

        contextLabels: {
            scene: 'Current Scene',
            characters: 'Characters Present',
            status: 'Current Status',
            health: 'Health',
            mana: 'Mana',
            inventory: 'Inventory',
            questProgress: 'Quest Progress',
            action: 'Recent Action',
            empty: 'None'
        }
    },
    'pt-BR': {
        intro: `Você é um Mestre de RPG controlado por IA em um mundo de fantasia medieval.

Contexto do Mundo:
O reino está repleto de magia, criaturas míticas e mistérios antigos. Cidades pulsam com mercadores, aventureiros e membros de guildas, enquanto criaturas perigosas espreitam na natureza selvagem. Ruínas antigas guardam tesouros esquecidos e segredos sombrios.

IMPORTANTE: TODAS AS RESPOSTAS DEVEM SER EM PORTUGUÊS DO BRASIL.
NUNCA RESPONDA EM INGLÊS.

Formato da Resposta:
[Narração] - Descrição detalhada da cena e resultados das ações
[Diálogo] - Respostas e conversas com NPCs
[Atmosfera] - Detalhes do ambiente e clima
[Sugestões de Ação] - Ações ou decisões disponíveis (3-4 opções interessantes)
[Efeitos] - Mudanças em saúde, mana, inventário ou status`,

        contextLabels: {
            scene: 'Cena Atual',
            characters: 'Personagens Presentes',
            status: 'Status do Jogador',
            health: 'Vida',
            mana: 'Mana',
            inventory: 'Inventário',
            questProgress: 'Progresso da Missão',
            action: 'Ação Recente',
            empty: 'Vazio'
        }
    }
};

export function getGamePrompt(language: SupportedLanguage) {
    const prompt = prompts[language];
    if (!prompt) {
        throw new Error(`Unsupported language: ${language}`);
    }
    return prompt;
}

export function buildContextString(context: GameContext, language: SupportedLanguage): string {
    const prompt = getGamePrompt(language);
    const labels = prompt.contextLabels;

    return `
${labels.scene}: ${context.scene}

${labels.characters}:
${context.characters.map(char => {
    const spells = char.spells?.map(s => `  - ${s.name} (${s.level === 0 ? 'Cantrip' : `Level ${s.level}`})`).join('\n') || 'None';
    const abilities = char.abilities?.map(a => `  - ${a.name}`).join('\n') || 'None';
    
    return `- ${char.name} (${char.class})
  Spells:
${spells}
  Abilities:
${abilities}`;
}).join('\n\n')}

${labels.status}:
- ${labels.health}: ${context.currentState.health}
- ${labels.mana}: ${context.currentState.mana}
- ${labels.inventory}: ${context.currentState.inventory.join(', ') || labels.empty}
- ${labels.questProgress}: ${context.currentState.questProgress}

${labels.action}: ${context.playerActions[0]}
    `.trim();
}

export function createFallbackResponse(context: GameContext): string {
    const language = context.language;
    const isEnglish = language === 'en-US';
    
    // Log that we're using a fallback
    logger.warn('Using fallback response for language:', language);

    const sections = isEnglish ? {
        narration: '[Narration] The adventure continues, though the path ahead is momentarily unclear...',
        dialogue: '[Dialogue] "Let us proceed carefully," your companion suggests.',
        atmosphere: '[Atmosphere] A moment of uncertainty hangs in the air.',
        suggestions: '[Suggested Choices]\n- Wait and observe the situation\n- Proceed with caution\n- Consult with your companions',
        effects: '[Effects] The group remains alert and ready.'
    } : {
        narration: '[Narração] A aventura continua, embora o caminho à frente esteja momentaneamente incerto...',
        dialogue: '[Diálogo] "Vamos prosseguir com cuidado," sugere seu companheiro.',
        atmosphere: '[Atmosfera] Um momento de incerteza paira no ar.',
        suggestions: '[Sugestões de Ação]\n- Aguardar e observar a situação\n- Prosseguir com cautela\n- Consultar seus companheiros',
        effects: '[Efeitos] O grupo permanece alerta e pronto.'
    };

    return Object.values(sections).join('\n\n');
} 