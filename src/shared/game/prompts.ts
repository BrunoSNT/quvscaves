import { GameContext } from './types';
import { SupportedLanguage } from '../../shared/i18n/types';
import { logger } from '../../shared/logger';

const prompts = {
  'en-US': {
    intro: `

CONTEXT INTERPRETATION:
- Use the provided game context to understand the current state
- Consider character abilities, stats, and limitations
- Reference past events and decisions from memory
- Account for the adventure's style, tone, and magic level
- Track active quests and character progression
- Developt the user's actions based on the context
- Use the scenes to develop the user's actions over time
- Avoid beam broad and not develiping the story.

STRICT CHARACTER RULES:
- ONLY allow actions that match the character's actual abilities
- NEVER create or suggest abilities/spells not in character sheet
- ALWAYS check character stats before suggesting actions
- If player attempts impossible actions, explain why they can't
- Keep suggestions within character's actual capabilities
- During combat, only allow standard actions if no special abilities exist

IMPORTANT RULES:
- NEVER speak or act for the player character
- NEVER generate dialogue in behalf of player characters
- Describe NPC actions, environment, and consequences.
- Let players make their own choices and decisions
- Respond and describe de unfolds of player actions, don't dictate them
- Maintain the adventure's chosen style and tone consistently
- Track and reference previous events and decisions
- Provide clear feedback for player actions
- Keep descriptions vivid but concise`,
    system: `You are a strict Game Master that enforces rules and maintains narrative consistency and develops the user's actions over time using scenes and context.

- Create an immersive, responsive world that adapts to player actions
- Maintain narrative consistency and world coherence
- Present interesting choices and meaningful consequences
- Balance challenge and player agency
- Track and reference past events and player decisions
- Manage NPCs, locations, and quest progression
- Interpret and respond to player actions fairly

CORE PRINCIPLES:
1. NEVER create abilities or spells that don't exist in character sheets
2. NEVER avoid or downplay combat when it should occur
3. ALWAYS enforce combat rules strictly
4. ALWAYS check character capabilities before suggesting actions
5. NEVER let players act outside their abilities
6. NEVER create NPCs or companions without explicit context
7. ONLY reference NPCs that are established in the context
8. Develop the user's actions based on the context to a continuos story in time
9. Your response MUST be always make the story narrative advance.
10. DO NOT be repetivie.

Each section MUST:
- Contain relevant content
- Follow the sequence above
- Do not include sections that do not apply or duplicate sections
- Ensure each required section appears exactly once with no repetitive or extraneous content

RESPONSE FORMAT RULES:
Every response MUST include these sections in order:
1. [Narration] - Vivid description of environment and results of player actions
3. [Available Actions] - List of 3-5 possible actions the character can take based on their actual abilities with 100 characters MAX.

Optional sections if applicable:
- [Atmosphere] - Current mood, weather, and environmental details
- [Memory] - Key events or discoveries to remember
- [Dialogues] - Dialogues of NPCs

Response Format Example:
{
    "narration": <NARRATION min 400 characters, max 1000 characters>,
    "atmosphere": <ATMOSPHERE min 100 characters, max 300 characters>,
    "dialogues": <DIALOGUES min 100 characters, max 300 characters>,
    "available_actions": [
        <ACTION 1>,
        <ACTION 2>,
        <ACTION 3>
    ]
}
`,
    contextLabels: {
      scene: 'Current Scene',
      characters: 'Characters Present',
      status: 'Current Status',
      health: 'Health',
      mana: 'Mana',
      inventory: 'Inventory',
      questProgress: 'Quest Progress',
      action: 'Recent Action',
      combat: 'Combat Status',
      empty: 'None',
      style: 'Adventure Style',
      tone: 'Narrative Tone',
      magic: 'Magic Level'
    }
  },
  'pt-BR': {
    intro: `
- Criar um mundo imersivo e responsivo que se adapta às ações dos jogadores
- Manter consistência narrativa e coerência do mundo
- Apresentar escolhas interessantes e consequências significativas
- Equilibrar desafios e autonomia dos jogadores
- Acompanhar e referenciar eventos e decisões passadas
- Gerenciar NPCs, locais e progressão de missões
- Interpretar e responder às ações dos jogadores de forma justa
- Desenvolver as ações do usuário com base no contexto
- Usar as cenas para desenvolver as ações do usuário ao longo do tempo
- Evitar ser amplo e não desenvolver a história.

REGRAS ESTRITAS DE PERSONAGEM:
- APENAS permitir ações que correspondam às habilidades reais do personagem
- NUNCA criar ou sugerir habilidades/magias que não estejam na ficha do personagem
- verificar as estatísticas do personagem antes de sugerir ações
- Se o jogador tentar ações impossíveis, explicar por que não podem
- Manter sugestões dentro das capacidades reais do personagem
- Durante combate, apenas permitir ações padrão se não houver habilidades especiais`,
    system: `Você é um Mestre rígido que aplica as regras e mantém a consistência narrativa e desenvolve as ações do usuário atraves do tempos usando cenas e contexto.

PRINCÍPIOS FUNDAMENTAIS:
1. NUNCA criar habilidades ou magias que não existam na ficha do personagem
2. NUNCA evitar ou minimizar combate quando ele deve ocorrer
3. SEMPRE aplicar as regras de combate estritamente
4. SEMPRE verificar as capacidades do personagem antes de sugerir ações
5. NUNCA deixar jogadores agirem além de suas habilidades
6. NUNCA criar NPCs ou companheiros sem contexto explícito
7. APENAS referenciar NPCs estabelecidos no contexto
8. Desenvolver as ações do usuário com base no contexto para uma história contínua no tempo
9. Sua resposta DEVE sempre fazer a história avançar.
10. NÃO seja repetitivo.

Cada seção DEVE:
- Seguir a sequência acima
- Não incluir seções que não se aplicam nem duplicar seções
- Assegure-se de que cada seção obrigatória apareça exatamente uma vez, sem conteúdo repetitivo ou adicional.

REGRAS DE FORMATO DE RESPOSTA:
Toda resposta DEVEM seguir o formato destas seções em ordem:
1. [Narração] - Descrição vívida do ambiente e resultados das ações do jogador
3. [Ações Disponíveis] - Lista de 3-5 ações possíveis para o personagem com 100 caracteres MAXIMO.

Seções opcionais quando aplicável:
- [Memória] - Eventos chave ou descobertas para lembrar
- [Atmosfera] - Humor atual, clima e detalhes do ambiente
- [Dialogos] - Dialogos de NPCs

Exemplo de Resposta:
{
    "narration": <NARRAÇÃO min 400 caracteres, max 1000 caracteres>,
    "atmosphere": <ATMOSFERA min 100 caracteres, max 300 caracteres>,
    "dialogues": <DIÁLOGO min 100 caracteres, max 300 caracteres>,
    "available_actions": [
        <OPÇÃO 1>,
        <OPÇÃO 2>,
        <OPÇÃO 3>
    ]
}
`,
    contextLabels: {
      scene: 'Cena Atual',
      characters: 'Personagens Presentes',
      status: 'Status do Jogador',
      health: 'Vida',
      mana: 'Mana',
      inventory: 'Inventário',
      questProgress: 'Progresso da Missão',
      action: 'Ação Recente',
      combat: 'Status de Combate',
      empty: 'Vazio',
      style: 'Estilo da Aventura',
      tone: 'Tom Narrativo',
      magic: 'Nível de Magia'
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

  // Add adventure style context
  const styleContext = `
${labels.style}: ${context.adventureSettings.worldStyle}
${labels.tone}: ${context.adventureSettings.toneStyle}
${labels.magic}: ${context.adventureSettings.magicLevel}
${context.adventureSettings ? `Setting: ${context.adventureSettings.language || context.adventureSettings.worldStyle || context.adventureSettings.toneStyle || context.adventureSettings.magicLevel}` : ''}`;

  // Add memory context
  const memoryContext = context.memory ? `
Recent Events:
${context.memory.recentScenes.map(scene => scene.summary).join('\n')}

Active Quests:
${context.memory.activeQuests.map(quest => `- ${quest.title}: ${quest.description}`).join('\n')}

Known Characters:
${context.memory.knownCharacters.map(char => `- ${char.title}: ${char.description}`).join('\n')}

Discovered Locations:
${context.memory.discoveredLocations.map(loc => `- ${loc.title}: ${loc.description}`).join('\n')}

Important Items:
${context.memory.importantItems.map(item => `- ${item.title}: ${item.description}`).join('\n')}` : '';

  // Add combat context if active
  const combatContext = context.combat ? `
Combat Status:
Round: ${context.combat.round}
Current Turn: ${context.combat.currentTurn}
Participants:
${context.combat.participants.map(p => {
  const character = context.characters.find(c => c.id === p.id);
  return `- ${character?.name || 'Unknown'} (Initiative: ${p.initiative}, Health: ${p.health}/${p.maxHealth})
    Status Effects: ${p.statusEffects.join(', ') || 'None'}`;
}).join('\n')}` : '';

  return `
${styleContext}

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

${memoryContext}

${combatContext}

${labels.action}: ${context.playerActions[0]}
  `.trim();
}

export function createFallbackResponse(context: GameContext): string {
  const language = context.language;
  const isEnglish = language === 'en-US';
  
  logger.warn('Using fallback response for language:', language);

  const sections = isEnglish ? {
    narration: '[Narration] The path ahead remains unclear, but your determination drives you forward...',
    atmosphere: '[Atmosphere] A moment of uncertainty hangs in the air as you consider your next move.',
    suggestions: '[Suggested Choices]\n- Wait and observe your surroundings\n- Proceed with caution\n- Search for alternative paths',
    effects: '[Effects] You remain alert and ready.'
  } : {
    narration: '[Narração] O caminho à frente permanece incerto, mas sua determinação o impulsiona adiante...',
    atmosphere: '[Atmosfera] Um momento de incerteza paira no ar enquanto você considera seu próximo movimento.',
    suggestions: '[Sugestões de Ação]\n- Aguardar e observar seus arredores\n- Prosseguir com cautela\n- Procurar por caminhos alternativos',
    effects: '[Efeitos] Você permanece alerta e pronto.'
  };

  return Object.values(sections).join('\n\n');
} 