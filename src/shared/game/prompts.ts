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

RESPONSE FORMAT RULES:
Every response MUST include these sections in order:
1. [Narration] - Vivid description of environment and results of player actions. 800 to 1200 characters.
3. [Available Actions] - List of 3-5 possible actions the character can take based on their actual abilities with 80 characters MAX.

Optional sections if applicable:
- [Atmosphere] - Current mood, weather, and environmental details
- [Memory] - Key events or discoveries to remember
- [Dialogues] - Dialogues of NPCs
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

REGRAS DE FORMATO DE RESPOSTA:
Toda resposta DEVEM seguir o formato destas seções em ordem:
1. [Narração] - Descrição vívida do ambiente e resultados das ações do jogador. 800 a 1200 caracteres.
3. [Ações Disponíveis] - Lista de 3-5 ações possíveis para o personagem com 80 caracteres MAXIMO.

Seções opcionais quando aplicável:
- [Memória] - Eventos chave ou descobertas para lembrar
- [Atmosfera] - Humor atual, clima e detalhes do ambiente
- [Dialogos] - Dialogos de NPCs
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

const combatPrompts = {
    'en-US': {
        initiation: `
COMBAT INITIATION RULES:
1. Monitor for aggressive actions or clear combat intent
2. Identify all potential combat participants
3. Roll initiative for all participants
4. Establish turn order
5. Set up initial combat state
6. Provide appropriate combat actions based on character abilities

COMBAT ACTION TYPES:
- ATTACK: Basic weapon attacks
- SPELL: Magical abilities from spellbook
- ABILITY: Special character abilities
- ITEM: Use combat items
- MOVE: Positioning and movement
- DEFEND: Defensive actions

Each combat turn MUST include:
1. Current participant's turn
2. Available combat actions
3. Environmental factors
4. Status effects
5. Position/range considerations`,
        
        turnUpdate: `
TURN PROGRESSION RULES:
1. Validate action against character capabilities
2. Process action results
3. Update combat state
4. Check for combat end conditions
5. Prepare next turn's options
6. Maintain narrative consistency`
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
${labels.style}: ${context.adventure?.worldStyle}
${labels.tone}: ${context.adventure?.toneStyle}
${labels.magic}: ${context.adventure?.magicLevel}
`;

  // Add memory context with emphasis on recent scenes for continuity
  const memoryContext = context.memory ? `
Recent Events:
${context.memory.recentScenes.map((scene, index) => 
  `${index + 1}. ${scene.summary}`
).join('\n')}

Current Scene:
${context.scene || ''}

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

  // Add character context
  const characterContext = context.characters.map(char => {
    const spells = char.spells?.map(s => `  - ${s.name} (${s.level === 0 ? 'Cantrip' : `Level ${s.level}`})`).join('\n') || 'None';
    const abilities = char.abilities?.map(a => `  - ${a.name}`).join('\n') || 'None';
    
    return `- ${char.name} (${char.class})
  Spells:
${spells}
  Abilities:
${abilities}`;
  }).join('\n\n');

  // Add current state context
  const stateContext = `
${labels.status}:
- ${labels.health}: ${context.currentState.health}
- ${labels.mana}: ${context.currentState.mana}
- ${labels.inventory}: ${context.currentState.inventory.join(', ') || labels.empty}
- ${labels.questProgress}: ${context.currentState.questProgress}`;

  // Add recent actions for continuity
  const recentActions = context.playerActions.length > 0 
    ? `\n\nRecent Actions:\n${context.playerActions.join('\n')}`
    : '';

  // Add additional context if any
  const additionalContext = context.additionalContext?.length
    ? `\n\nAdditional Context:\n${context.additionalContext.join('\n')}`
    : '';

  return `
${styleContext}

${characterContext}

${stateContext}

${memoryContext}

${combatContext}

${recentActions}

${additionalContext}

Current Action: ${context.playerActions[0]}
  `.trim();
}

export function createFallbackResponse(language: string): string {
  const isEnglish = language === 'en-US';
  
  logger.warn('Using fallback response for language:', language);

  const response = isEnglish ? {
    narration: 'The path ahead remains unclear, but your determination drives you forward. The situation demands careful consideration of your next move.',
    atmosphere: 'A moment of uncertainty hangs in the air, creating a tense but contemplative atmosphere.',
    available_actions: [
      'Wait and observe your surroundings',
      'Proceed with caution',
      'Search for alternative paths'
    ]
  } : {
    narracao: 'O caminho à frente permanece incerto, mas sua determinação o impulsiona adiante. A situação exige consideração cuidadosa do seu próximo movimento.',
    atmosfera: 'Um momento de incerteza paira no ar, criando uma atmosfera tensa mas contemplativa.',
    acoes_disponiveis: [
      'Aguardar e observar seus arredores',
      'Prosseguir com cautela',
      'Procurar por caminhos alternativos'
    ]
  };

  return JSON.stringify(response);
} 