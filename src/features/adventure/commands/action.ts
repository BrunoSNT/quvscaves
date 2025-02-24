import { ChatInputCommandInteraction, ButtonStyle, MessageFlags, VoiceChannel, ChannelType, BaseGuildVoiceChannel, GuildVoiceChannelResolvable, MessageComponentInteraction } from 'discord.js';
import { AdventureService } from '../services/adventure';
import { logger, prettyPrintLog, formatGenericOutput } from '../../../shared/logger';
import { translate } from '../../../shared/i18n/translations';
import { GameMaster } from '../../../ai/gamemaster';
import { prisma } from '../../../core/prisma';
import { VoiceConfig } from '../../voice/types';
import { getVoiceService } from '../../voice/services';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
import { Readable } from 'stream';
import { GameContext } from '../../../shared/game/types';
import { Adventure } from '../types';
import chalk from 'chalk';
import { ActionType, GameAction } from '../../../shared/game/types';
import { v4 as uuidv4 } from 'uuid';
import { Orchestrator } from '../../../ai/orchestrator';
import { SkillCheck } from '../../../shared/game/skills';
import { entersState } from '@discordjs/voice';
import { StreamType } from '@discordjs/voice';
import { VectorStore } from '../../../core/vector/store';
import { DefaultCharacterService } from '../../character/services/character';
import { GameReward } from '../../../shared/game/types';
import { ContextManager } from '../../../shared/game/context';
import { formatCharacterSheet } from '../../../shared/discord/sheet';

const adventureService = new AdventureService();
const activeConnections = new Map<string, VoiceConnection>();

const voiceConnectionPool = new Map<string, {
    connection: VoiceConnection;
    lastUsed: number;
    disconnectTimeout?: NodeJS.Timeout;
}>();

function cleanupOldConnections() {
    const now = Date.now();
    for (const [guildId, data] of voiceConnectionPool.entries()) {
        if (now - data.lastUsed > 5 * 60 * 1000) { // 5 minutes
            if (data.disconnectTimeout) {
                clearTimeout(data.disconnectTimeout);
            }
            data.connection.destroy();
            voiceConnectionPool.delete(guildId);
        }
    }
}

setInterval(cleanupOldConnections, 60 * 1000);

export const ACTION_CONCEPTS = {
    "en-US": {
        "combat": {
            concepts: ["fight", "attack", "battle", "weapon", "sword", "hit", "kill", "defend", "strike", "combat", "slash", "block", "parry", "dodge", "shield"],
            emoji: "⚔️"
        },
        "movement": {
            concepts: ["walk", "run", "jump", "climb", "move", "travel", "go", "enter", "leave", "escape", "sprint", "dash", "crawl", "swim", "fly"],
            emoji: "🏃"
        },
        "interaction": {
            concepts: ["talk", "speak", "ask", "tell", "chat", "communicate", "discuss", "conversation", "dialogue", "greet", "respond", "answer", "reply", "shout"],
            emoji: "💬"
        },
        "observation": {
            concepts: ["look", "watch", "observe", "examine", "inspect", "search", "investigate", "study", "analyze", "scan", "spot", "notice", "detect", "find"],
            emoji: "👀"
        },
        "item": {
            concepts: ["pick", "take", "grab", "use", "hold", "carry", "item", "object", "tool", "equipment", "weapon", "potion", "scroll", "inventory", "bag"],
            emoji: "🎒"
        },
        "magic": {
            concepts: ["cast", "spell", "magic", "enchant", "ritual", "mystic", "arcane", "magical", "power", "sorcery", "wizardry", "conjure", "summon", "charm"],
            emoji: "✨"
        },
        "stealth": {
            concepts: ["hide", "sneak", "stealth", "quiet", "silent", "careful", "cautious", "secretive", "lurk", "prowl", "shadow", "conceal", "disguise"],
            emoji: "🥷"
        },
        "social": {
            concepts: ["persuade", "convince", "charm", "negotiate", "diplomatic", "social", "friendly", "intimidate", "deceive", "bluff", "lie", "threaten"],
            emoji: "🤝"
        },
        "skill": {
            concepts: ["craft", "create", "make", "build", "skill", "ability", "expertise", "proficiency", "knowledge", "learn", "practice", "train", "improve"],
            emoji: "🛠️"
        },
        "rest": {
            concepts: ["sleep", "rest", "wait", "pause", "relax", "recover", "heal", "restore", "meditate", "camp", "break", "sit", "lay", "nap"],
            emoji: "💤"
        },
        "exploration": {
            concepts: ["explore", "discover", "map", "scout", "survey", "wander", "venture", "trek", "journey", "navigate", "chart", "roam", "patrol"],
            emoji: "🗺️"
        },
        "trade": {
            concepts: ["buy", "sell", "trade", "barter", "haggle", "shop", "purchase", "deal", "merchant", "market", "price", "coin", "gold", "payment"],
            emoji: "💰"
        }
    },
    "pt-BR": {
        "combat": {
            concepts: ["lutar", "atacar", "batalhar", "arma", "espada", "golpear", "matar", "defender", "combater", "bloquear", "aparar", "esquivar", "escudo"],
            emoji: "⚔️"
        },
        "movement": {
            concepts: ["andar", "correr", "pular", "escalar", "mover", "viajar", "ir", "entrar", "sair", "escapar", "disparar", "rastejar", "nadar", "voar"],
            emoji: "🏃"
        },
        "interaction": {
            concepts: ["falar", "conversar", "perguntar", "dizer", "comunicar", "discutir", "dialogar", "cumprimentar", "responder", "gritar", "chamar"],
            emoji: "💬"
        },
        "observation": {
            concepts: ["olhar", "observar", "examinar", "inspecionar", "procurar", "investigar", "estudar", "analisar", "escanear", "notar", "detectar", "encontrar"],
            emoji: "👀"
        },
        "item": {
            concepts: ["pegar", "apanhar", "agarrar", "usar", "segurar", "carregar", "item", "objeto", "ferramenta", "equipamento", "poção", "pergaminho", "inventário"],
            emoji: "🎒"
        },
        "magic": {
            concepts: ["conjurar", "feitiço", "magia", "encantar", "ritual", "místico", "arcano", "mágico", "poder", "feitiçaria", "bruxaria", "invocar", "encantar"],
            emoji: "✨"
        },
        "stealth": {
            concepts: ["esconder", "esgueirar", "furtivo", "quieto", "silencioso", "cuidadoso", "cauteloso", "secreto", "ocultar", "disfarçar", "camuflar"],
            emoji: "🥷"
        },
        "social": {
            concepts: ["persuadir", "convencer", "encantar", "negociar", "diplomático", "social", "amigável", "intimidar", "enganar", "blefar", "mentir", "ameaçar"],
            emoji: "🤝"
        },
        "skill": {
            concepts: ["criar", "construir", "fazer", "habilidade", "perícia", "especialidade", "proficiência", "conhecimento", "aprender", "praticar", "treinar"],
            emoji: "🛠️"
        },
        "rest": {
            concepts: ["dormir", "descansar", "esperar", "pausar", "relaxar", "recuperar", "curar", "restaurar", "meditar", "acampar", "sentar", "deitar"],
            emoji: "💤"
        },
        "exploration": {
            concepts: ["explorar", "descobrir", "mapear", "vigiar", "vagar", "aventurar", "jornada", "navegar", "cartografar", "patrulhar", "reconhecer"],
            emoji: "🗺️"
        },
        "trade": {
            concepts: ["comprar", "vender", "trocar", "barganhar", "pechinchar", "comerciar", "negociar", "mercador", "mercado", "preço", "moeda", "ouro"],
            emoji: "💰"
        }
    }
};

const ABILITY_SKILLS = {
    "en-US": {
        "strength": {
            name: "Strength",
            concepts: ["athletics", "lifting", "carrying", "physical power", "muscular", "brute force", "raw power", "might"],
            skills: ["athletics"]
        },
        "dexterity": {
            name: "Dexterity",
            concepts: ["acrobatics", "stealth", "sleight of hand", "agility", "balance", "coordination", "reflexes", "finesse"],
            skills: ["acrobatics", "stealth", "sleight_of_hand"]
        },
        "constitution": {
            name: "Constitution",
            concepts: ["endurance", "stamina", "vitality", "health", "toughness", "resilience", "fortitude"],
            skills: ["concentration"]
        },
        "intelligence": {
            name: "Intelligence",
            concepts: ["arcana", "history", "investigation", "nature", "knowledge", "logic", "memory", "reasoning", "study"],
            skills: ["arcana", "history", "investigation", "nature"]
        },
        "wisdom": {
            name: "Wisdom",
            concepts: ["animal handling", "insight", "medicine", "perception", "survival", "intuition", "awareness", "spirituality", "religion"],
            skills: ["animal_handling", "insight", "medicine", "perception", "survival", "religion"]
        },
        "charisma": {
            name: "Charisma",
            concepts: ["deception", "intimidation", "performance", "persuasion", "social", "leadership", "personality", "presence"],
            skills: ["deception", "intimidation", "performance", "persuasion"]
        }
    },
    "pt-BR": {
        "strength": {
            name: "Força",
            concepts: ["atletismo", "levantar", "carregar", "poder físico", "muscular", "força bruta", "poder"],
            skills: ["athletics"]
        },
        "dexterity": {
            name: "Destreza",
            concepts: ["acrobacia", "furtividade", "prestidigitação", "agilidade", "equilíbrio", "coordenação", "reflexos"],
            skills: ["acrobatics", "stealth", "sleight_of_hand"]
        },
        "constitution": {
            name: "Constituição",
            concepts: ["resistência", "vigor", "vitalidade", "saúde", "tenacidade", "resiliência", "fortitude"],
            skills: ["concentration"]
        },
        "intelligence": {
            name: "Inteligência",
            concepts: ["arcana", "história", "investigação", "natureza", "conhecimento", "lógica", "memória", "raciocínio", "estudo"],
            skills: ["arcana", "history", "investigation", "nature"]
        },
        "wisdom": {
            name: "Sabedoria",
            concepts: ["adestrar animais", "intuição", "medicina", "percepção", "sobrevivência", "intuição", "consciência", "espiritualidade", "religião"],
            skills: ["animal_handling", "insight", "medicine", "perception", "survival", "religion"]
        },
        "charisma": {
            name: "Carisma",
            concepts: ["enganação", "intimidação", "atuação", "persuasão", "social", "liderança", "personalidade", "presença"],
            skills: ["deception", "intimidation", "performance", "persuasion"]
        }
    }
};

const EMOJI_MAP: Record<string, string> = {
    "combat": "⚔️",
    "movement": "🏃",
    "dialogue": "💬",
    "question": "❓",
    "observation": "👀",
    "item": "🎒",
    "magic": "✨",
    "stealth": "🥷",
    "diplomacy": "🤝",
    "skill": "🛠️",
    "rest": "💤",
    "search": "🔍",
    "default": "➡️",
};

function splitIntoChunks(text: string): string[] {
    // Only split if text is longer than 500 characters
    if (text.length <= 500) {
        return [text];
    }

    // Split into paragraphs first
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
        // If paragraph is short enough, keep it as is
        if (paragraph.length <= 500) {
            chunks.push(paragraph);
            continue;
        }

        // Split long paragraphs at sentence boundaries
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let currentChunk = '';

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > 500) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
    }

    return chunks;
}

class PromiseHandler {
    private resolveStarted: ((value: void | PromiseLike<void>) => void) | undefined;
    private rejectStarted: ((reason: any) => void) | undefined;
    private resolveFinished: ((value: void | PromiseLike<void>) => void) | undefined;
    private rejectFinished: ((reason: any) => void) | undefined;
    public startedPlaying: Promise<void>;
    public finished: Promise<void>;

    constructor() {
        this.startedPlaying = new Promise<void>((resolve, reject) => {
            this.resolveStarted = resolve;
            this.rejectStarted = reject;
        });

        this.finished = new Promise<void>((resolve, reject) => {
            this.resolveFinished = resolve;
            this.rejectFinished = reject;
        });
    }

    resolveStart() {
        if (this.resolveStarted) this.resolveStarted();
    }

    resolveFinish() {
        if (this.resolveFinished) this.resolveFinished();
    }

    reject(error: any) {
        if (this.rejectStarted) this.rejectStarted(error);
        if (this.rejectFinished) this.rejectFinished(error);
    }
}

function createRollButton(skillCheck: SkillCheck) {
    const buttonId = `roll_${skillCheck.skill}_${skillCheck.difficulty}_${skillCheck.advantage ? '1' : '0'}_${skillCheck.disadvantage ? '1' : '0'}_${uuidv4()}`;
    return {
        type: 2,
        style: ButtonStyle.Primary,
        label: `Roll ${skillCheck.skill.charAt(0).toUpperCase() + skillCheck.skill.slice(1)} Check (DC ${skillCheck.difficulty})`,
        custom_id: buttonId
    };
}

async function getAbilityForSkill(skill: string, language: string = 'en-US'): Promise<string> {
    try {
        const vectorStore = VectorStore.getInstance();
        let highestSimilarity = -1;
        let bestAbility = "wisdom"; // Default to wisdom if no match found

        // Get ability scores for the current language
        const abilityScores = ABILITY_SKILLS[language as keyof typeof ABILITY_SKILLS] || ABILITY_SKILLS['en-US'];

        // First try direct match with skills arrays
        for (const [ability, data] of Object.entries(abilityScores)) {
            if (data.skills.includes(skill.toLowerCase())) {
                return ability;
            }
        }

        // If no direct match, use vector similarity with concepts
        for (const [ability, data] of Object.entries(abilityScores)) {
            const { similarity } = await vectorStore.compareWithConcepts(skill, data.concepts);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestAbility = ability;
            }
        }

        return bestAbility;
    } catch (error) {
        logger.error('Error getting ability for skill:' + formatGenericOutput(JSON.stringify(error)));
        return "wisdom"; // Default to wisdom on error
    }
}

async function handleRollAction(interaction: any, character?: any, language: string = 'en-US') {
    try {
        // Check if interaction needs to be deferred
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        // Extract skill check data from button ID
        const [_, skill, difficultyStr, advantageStr, disadvantageStr] = interaction.customId.split('_');
        const difficulty = parseInt(difficultyStr);
        const advantage = advantageStr === '1';
        const disadvantage = disadvantageStr === '1';

        const skillCheck: SkillCheck = {
            skill,
            difficulty,
            advantage,
            disadvantage
        };

        // If no character was passed, try to fetch it
        if (!character) {
            // First try to find the active adventure for this user
            const adventure = await prisma.adventure.findFirst({
                where: {
                    status: 'ACTIVE',
                    players: {
                        some: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                },
                include: {
                    players: {
                        include: {
                            character: {
                                include: {
                                    CharacterSpell: true,
                                    CharacterAbility: true
                                }
                            },
                            user: true
                        }
                    }
                }
            });

            if (!adventure) {
                logger.error('No active adventure found for user:' + formatGenericOutput(JSON.stringify(interaction.user.id)));
                await interaction.editReply({
                    content: language === 'en-US'
                        ? 'Error: No active adventure found'
                        : 'Erro: Nenhuma aventura ativa encontrada',
                    components: []
                });
                return null;
            }

            // Find the player's character in this adventure
            const player = adventure.players.find(p => p.user.discordId === interaction.user.id);
            if (!player || !player.character) {
                logger.error('No character found for user in adventure: ' + formatGenericOutput(JSON.stringify({
                    userId: interaction.user.id,
                    adventureId: adventure.id
                })));
                await interaction.editReply({
                    content: language === 'en-US'
                        ? 'Error: Character not found in this adventure'
                        : 'Erro: Personagem não encontrado nesta aventura',
                    components: []
                });
                return null;
            }

            character = player.character;
            language = adventure.language || 'en-US';
        }

        // Verify character has required stats
        if (!character.stats) {
            logger.error('Character missing stats:' + formatGenericOutput(JSON.stringify(character.id)));
            await interaction.editReply({
                content: language === 'en-US'
                    ? 'Error: Character stats not found'
                    : 'Erro: Estatísticas do personagem não encontradas',
                components: []
            });
            return null;
        }

        // Get the corresponding ability score for this skill
        const ability = await getAbilityForSkill(skill, language);
        
        // Get ability modifier from character stats
        const abilityModifier = character.stats && character.stats[ability as keyof typeof character.stats]
            ? Math.floor((character.stats[ability as keyof typeof character.stats] - 10) / 2)
            : 0;

        // Roll the check
        const roll = Math.floor(Math.random() * 20) + 1; // 1d20
        let total = roll + abilityModifier;

        // Apply advantage/disadvantage
        if (advantage) {
            const secondRoll = Math.floor(Math.random() * 20) + 1;
            total = Math.max(total, secondRoll + abilityModifier);
        } else if (disadvantage) {
            const secondRoll = Math.floor(Math.random() * 20) + 1;
            total = Math.min(total, secondRoll + abilityModifier);
        }

        // Apply modifiers
        if (skillCheck.modifiers) {
            total += Object.values(skillCheck.modifiers).reduce((sum, mod) => sum + (mod || 0), 0);
        }

        const result = {
            success: total >= skillCheck.difficulty,
            roll: roll,
            total: total,
            difficulty: skillCheck.difficulty,
            margin: total - skillCheck.difficulty,
            criticalSuccess: roll === 20,
            criticalFailure: roll === 1
        };

        // Get ability name in correct language
        const abilityData = ABILITY_SKILLS[language as keyof typeof ABILITY_SKILLS]?.[ability as keyof (typeof ABILITY_SKILLS)['en-US']];
        const abilityName = abilityData?.name || ability;

        // Format roll result message with embed
        try {
            await interaction.editReply({
                embeds: [{
                    title: language === 'en-US' 
                        ? `🎲 ${character.name}'s ${skill} Check`
                        : `🎲 Teste de ${skill} de ${character.name}`,
                    description: language === 'en-US'
                        ? `Using ${abilityName} (${abilityModifier >= 0 ? '+' : ''}${abilityModifier})`
                        : `Usando ${abilityName} (${abilityModifier >= 0 ? '+' : ''}${abilityModifier})`,
                    fields: [
                        {
                            name: language === 'en-US' ? 'Roll' : 'Rolagem',
                            value: `${roll}${result.criticalSuccess ? ' (Critical Success!)' : result.criticalFailure ? ' (Critical Failure!)' : ''}`,
                            inline: true
                        },
                        {
                            name: language === 'en-US' ? 'Total' : 'Total',
                            value: `${total}`,
                            inline: true
                        },
                        {
                            name: 'DC/CD',
                            value: `${difficulty}`,
                            inline: true
                        },
                        {
                            name: language === 'en-US' ? 'Result' : 'Resultado',
                            value: result.success 
                                ? `✅ ${language === 'en-US' ? 'Success' : 'Sucesso'} (${language === 'en-US' ? 'by' : 'por'} ${Math.abs(result.margin)})`
                                : `❌ ${language === 'en-US' ? 'Failure' : 'Falha'} (${language === 'en-US' ? 'by' : 'por'} ${Math.abs(result.margin)})`,
                            inline: false
                        }
                    ],
                    color: result.success ? 0x00ff00 : 0xff0000
                }],
                components: []
            });
        } catch (replyError) {
            logger.error('Error sending roll result:' + formatGenericOutput(JSON.stringify(replyError)));
            // Don't throw here - we still want to return the result
        }

        return result;
    } catch (error) {
        logger.error('Error in handleRollAction:' + formatGenericOutput(JSON.stringify(error)));
        return null;
    }
}

async function handleActionResponse(interaction: ChatInputCommandInteraction | any, context: GameContext, action: string) {
    try {
        // Verify character exists before proceeding
        const character = context.characters[0];
        if (!character) {
            throw new Error('Character not found');
        }

        // Initialize context manager
        const contextManager = new ContextManager(context);

        // Log the initial action request
        logger.debug('Processing action request:\n' + prettyPrintLog(JSON.stringify({
            action,
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            adventureId: context.adventure?.id,
            language: context.language,
            characterName: character.name
        })) + "\n\n");

        // 1. First, display the user's action in a new message
        const channel = interaction.channel;
        const actionMessage = await channel.send({
            embeds: [{
                title: `🎭 ${character.name.charAt(0).toUpperCase() + character.name.slice(1)} action`,
                description: action,
                color: 0x3498db,
            }]
        });

        // 2. Check for combat intent
        const gameMaster = new GameMaster(context.adventure?.id || '');
        const combatResult = await gameMaster.detectCombatIntent(action, context);
        
        if (combatResult.isCombat) {
            // Initialize combat if not already in combat
            if (!context.combat) {
                context.combat = await gameMaster.initializeCombat(context, combatResult);
                await channel.send({
                    content: context.language === 'en-US'
                        ? '⚔️ **Combat Initiated!**\nRolling initiative...'
                        : '⚔️ **Combate Iniciado!**\nRolando iniciativa...'
                });
            }
        }

        // 3. Check if action requires a skill check - do this ONCE
        const skillCheck = await gameMaster.determineSkillCheck(action, context);
        let skillCheckResult = null;

        if (skillCheck) {
            // Get rollMode from either adventure.rollMode or adventure.settings.rollMode
            const rollMode = context.adventure?.rollMode || context.adventure?.settings.rollMode;
            if (rollMode === 'ACTIVE') {
                // Active rolling mode - create roll button and wait for interaction
                const rollButton = createRollButton(skillCheck);
                const rollMessage = await channel.send({
                    content: context.language === 'en-US'
                        ? `⚠️ **This action requires a ${skillCheck.skill} check!**\n👉 Click the button below to roll.`
                        : `⚠️ **Esta ação requer um teste de ${skillCheck.skill}!**\n👉 Clique no botão abaixo para rolar.`,
                    components: [{
                        type: 1,
                        components: [rollButton]
                    }]
                });

                try {
                    const rollInteraction = await rollMessage.awaitMessageComponent({
                        filter: (i: MessageComponentInteraction) => {
                            return i.customId === rollButton.custom_id && i.user.id === interaction.user.id;
                        },
                        time: 600000 // 10 minutes
                    });

                    skillCheckResult = await handleRollAction(rollInteraction, character, context.language);
                    
                    if (!skillCheckResult) {
                        return;
                    }

                    // Add skill check result to context
                    contextManager.addSkillCheckResult(
                        skillCheckResult.success,
                        skillCheckResult.margin,
                        skillCheckResult.criticalSuccess,
                        skillCheckResult.criticalFailure
                    );
                } catch (error) {
                    logger.error('Error waiting for roll interaction:' + formatGenericOutput(JSON.stringify(error)));
                    await rollMessage.edit({
                        content: context.language === 'en-US'
                            ? '❌ Roll timed out after 10 minutes. Please try your action again.'
                            : '❌ Tempo esgotado após 10 minutos. Por favor, tente sua ação novamente.',
                        components: []
                    });
                    return;
                }
            } else {
                // Background rolling mode - automatically roll
                const mockInteraction = {
                    customId: `roll_${skillCheck.skill}_${skillCheck.difficulty}_${skillCheck.advantage ? '1' : '0'}_${skillCheck.disadvantage ? '1' : '0'}_${uuidv4()}`,
                    deferred: true,
                    editReply: async (msg: any) => {
                        await channel.send(msg);
                    }
                };
                
                skillCheckResult = await handleRollAction(mockInteraction, character, context.language);
                
                if (!skillCheckResult) {
                    return;
                }

                // Add skill check result to context
                contextManager.addSkillCheckResult(
                    skillCheckResult.success,
                    skillCheckResult.margin,
                    skillCheckResult.criticalSuccess,
                    skillCheckResult.criticalFailure
                );
            }
        }

        // Store the skill check result in context for the AI to use
        if (skillCheckResult && skillCheck) {
            context.lastSkillCheck = {
                check: skillCheck,
                result: skillCheckResult
            };
        }

        // NEW: Check for potential rewards before AI response
        const potentialRewards = await gameMaster.determineRewards(action, context);
        
        // 4. Generate AI response - now with access to skill check result via context
        const response = await gameMaster.generateResponse(context);
        
        if (!response || typeof response !== 'string') {
            logger.error('Invalid AI response format:\n' + prettyPrintLog(JSON.stringify({ response })) + "\n\n");
            throw new Error('Invalid AI response format');
        }

        // 5. Parse and validate the response
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response);
            logger.debug('Successfully parsed AI response:\n' + prettyPrintLog(JSON.stringify({ parsedResponse })) + "\n\n");

            // Merge AI-determined rewards with our system-determined rewards
            if (potentialRewards?.length) {
                parsedResponse.rewards = [
                    ...(parsedResponse.rewards || []),
                    ...potentialRewards
                ];
            }

            // Process rewards if present
            if (parsedResponse.rewards?.length) {
                const characterService = new DefaultCharacterService();
                await characterService.addRewardsToCharacter(character.id, parsedResponse.rewards);

                // Add rewards to context
                parsedResponse.rewards.forEach((reward: GameReward) => {
                    contextManager.addReward(reward);
                });
            }

            // Check for loot from containers or NPCs
            if (parsedResponse.loot) {
                const characterService = new DefaultCharacterService();
                await characterService.addRewardsToCharacter(character.id, parsedResponse.loot.rewards);

                // Add loot to context
                contextManager.addLoot(parsedResponse.loot.description, parsedResponse.loot.rewards);
            }

            // 6. Extract response components
            const narrationText = context.language === 'en-US' 
                ? parsedResponse.narration
                : parsedResponse.narracao;
            
            const atmosphereText = context.language === 'en-US'
                ? parsedResponse.atmosphere
                : parsedResponse.atmosfera;

            const suggestedActions = context.language === 'en-US'
                ? parsedResponse.available_actions
                : parsedResponse.acoes_disponiveis;

            if (!narrationText || !suggestedActions?.length) {
                logger.error('Invalid response structure:\n' + prettyPrintLog(JSON.stringify({ parsedResponse })) + "\n\n");
                throw new Error('Invalid response structure - missing required fields');
            }

            // Format the response for display
            const formattedResponse = context.language === 'en-US' 
                ? `📖 **Narration**\n${narrationText}${atmosphereText ? `\n\n🌍 **Atmosphere**\n${atmosphereText}` : ''}${contextManager.getFormattedContext()}\n\n⚡ **Fast Actions**\n${suggestedActions.map((a: string) => `• ${a}`).join('\n')}\n`
                : `📖 **Narração**\n${narrationText}${atmosphereText ? `\n\n🌍 **Atmosfera**\n${atmosphereText}` : ''}${contextManager.getFormattedContext()}\n\n⚡ **Ações Rápidas**\n${suggestedActions.map((a: string) => `• ${a}`).join('\n')}\n`;

            // 8. Format the response for display
            const formattedResponseWithContext = formattedResponse;

            // 9. Store memory
            if (context.adventure?.id) {
                try {
                    const orchestrator = new Orchestrator(context.adventure.id);
                    await orchestrator.processInput(action, context);
                    await orchestrator.storeResponse(narrationText, context);
                    logger.debug('Successfully stored scene memory');
                } catch (memoryError) {
                    logger.error('Error creating scene memory:\n' + memoryError);
                }
            }

            // 10. Display response and handle voice
            let responseMessage;
            try {
                // Send initial response
                responseMessage = await channel.send({
                    embeds: [{
                        title: '🎭 Action Result',
                        description: formattedResponseWithContext,
                        color: 0x99ff99,
                        footer: {
                            text: context.language === 'en-US' 
                                ? `💭 *Use /action for custom actions*`
                                : `💭 *Use /action para ações personalizadas*`
                        }
                    }]
                });

                // Handle voice if enabled
                if (context.adventure?.voiceType !== 'NONE' && interaction.guild && context.adventure?.categoryId) {
                    try {
                        const category = interaction.guild.channels.cache.get(context.adventure.categoryId);
                        if (category?.type === ChannelType.GuildCategory) {
                            const voiceChannel = category.children.cache.find(
                                (channel: { name: string; type: ChannelType; }) => 
                                    channel.name.toLowerCase() === 'table' && 
                                    channel.type === ChannelType.GuildVoice
                            ) as VoiceChannel;

                            if (voiceChannel) {
                                logger.info(`Found voice channel: ${voiceChannel.name} in category ${category.name}`);
                                
                                // Configure voice service
                                const voiceConfig: VoiceConfig = {
                                    provider: context.adventure.voiceType === 'ELEVENLABS' ? 'ELEVENLABS' : 'KOKORO',
                                    language: context.language
                                };

                                if (voiceConfig.provider === 'ELEVENLABS') {
                                    voiceConfig.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
                                }

                                logger.debug('Voice configuration: ' + {
                                    provider: voiceConfig.provider,
                                    language: voiceConfig.language,
                                    hasElevenLabsKey: !!voiceConfig.ELEVENLABS_API_KEY
                                });

                                // Get voice service and generate audio
                                const voiceService = await getVoiceService(voiceConfig.provider);
                                const audioBuffer = await voiceService.speak(narrationText, voiceConfig);

                                if (!audioBuffer || audioBuffer.length === 0) {
                                    logger.warn('Received empty audio buffer from voice service');
                                    return;
                                }

                                logger.info('Successfully generated audio, checking voice connection...');

                                // Check for existing connection or create new one
                                let connection = activeConnections.get(voiceChannel.guild.id);
                                let isNewConnection = false;

                                if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
                                    isNewConnection = true;
                                    connection = joinVoiceChannel({
                                        channelId: voiceChannel.id,
                                        guildId: voiceChannel.guild.id,
                                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                                        selfDeaf: false,
                                        selfMute: false
                                    });
                                    activeConnections.set(voiceChannel.guild.id, connection);
                                }

                                // Only wait for connection if it's new
                                if (isNewConnection) {
                                    try {
                                        await new Promise<void>((resolve, reject) => {
                                            const timeout = setTimeout(() => {
                                                reject(new Error('Voice connection timeout'));
                                            }, 30000);

                                            const readyHandler = () => {
                                                clearTimeout(timeout);
                                                connection.off(VoiceConnectionStatus.Ready, readyHandler);
                                                resolve();
                                            };

                                            connection.on(VoiceConnectionStatus.Ready, readyHandler);

                                            // Handle disconnection
                                            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                                                try {
                                                    await Promise.race([
                                                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                                                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                                                    ]);
                                                } catch (error) {
                                                    clearTimeout(timeout);
                                                    connection.destroy();
                                                    activeConnections.delete(voiceChannel.guild.id);
                                                    reject(error);
                                                }
                                            });
                                        });
                                    } catch (error) {
                                        logger.error('Failed to establish voice connection:' + formatGenericOutput(JSON.stringify(error)));
                                        activeConnections.delete(voiceChannel.guild.id);
                                        throw error;
                                    }
                                }

                                // Create audio player if needed
                                const player = createAudioPlayer();
                                connection.subscribe(player);

                                // Create audio resource and play
                                const stream = Readable.from(audioBuffer);
                                const resource = createAudioResource(stream, {
                                    inputType: StreamType.Arbitrary,
                                    inlineVolume: true
                                });

                                if (resource.volume) {
                                    resource.volume.setVolume(1.0);
                                }

                                // Create promises for tracking playback
                                const voicePromises = {
                                    startedPlaying: new Promise<void>((resolve) => {
                                        player.once(AudioPlayerStatus.Playing, () => {
                                            logger.info('Started playing audio');
                                            resolve();
                                        });
                                    }),
                                    finished: new Promise<void>((resolve) => {
                                        player.once(AudioPlayerStatus.Idle, () => {
                                            logger.info('Finished playing audio');
                                            // Set a timeout to disconnect, but store it so it can be cancelled
                                            const disconnectTimeout = setTimeout(() => {
                                                logger.info('No new actions detected, disconnecting from voice channel');
                                                safeDestroyConnection(connection, voiceChannel.guild.id);
                                            }, Math.max(60000, 1)); // Ensure timeout is at least 1ms

                                            // Store the timeout
                                            (connection as any).disconnectTimeout = disconnectTimeout;
                                            resolve();
                                        });
                                    })
                                };

                                // Handle connection state changes
                                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                                    try {
                                        await Promise.race([
                                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                                        ]);
                                    } catch (error) {
                                        logger.info('Connection disconnected, cleaning up...');
                                        safeDestroyConnection(connection, voiceChannel.guild.id);
                                    }
                                });

                                connection.on(VoiceConnectionStatus.Destroyed, () => {
                                    logger.info('Connection destroyed, cleaning up...');
                                    activeConnections.delete(voiceChannel.guild.id);
                                    if ((connection as any).disconnectTimeout) {
                                        clearTimeout((connection as any).disconnectTimeout);
                                        delete (connection as any).disconnectTimeout;
                                    }
                                });

                                // Clear any existing disconnect timeout
                                if ((connection as any).disconnectTimeout) {
                                    clearTimeout((connection as any).disconnectTimeout);
                                    delete (connection as any).disconnectTimeout;
                                }

                                player.play(resource);
                                logger.info('Audio playback started');
                            } else {
                                logger.warn('Voice channel "table" not found in category');
                            }
                        }
                    } catch (voiceError) {
                        logger.error('Error in voice setup:' + formatGenericOutput(JSON.stringify(voiceError)));
                    }
                }

                // Add action buttons
                if (responseMessage) {
                    try {
                        const actionObjects = suggestedActions.map((actionText: string) => ({
                            type: ActionType.NARRATIVE,
                            text: actionText
                        }));
                        const buttons = await createActionButtons(actionObjects, context.language);
                        const components = buttons.length > 0 ? [{
                            type: 1,
                            components: buttons
                        }] : [];

                        logger.debug('Adding action buttons:\n' + prettyPrintLog(JSON.stringify({ 
                            buttonCount: buttons.length,
                            actions: actionObjects
                        })) + "\n\n");

                        await responseMessage.edit({
                            embeds: [{
                                title: '🎭 Action Result',
                                description: formattedResponseWithContext,
                                color: 0x99ff99,
                            }],
                            components: components
                        });
                    } catch (buttonError) {
                        logger.error('Error adding action buttons:' + formatGenericOutput(JSON.stringify(buttonError)));
                    }
                }

                // Clear the thinking state
                if (interaction.deferred) {
                    await interaction.editReply({ 
                        content: context.language === 'en-US' ? '✅ Action completed' : '✅ Ação concluída'
                    });
                }

                logger.info(`Action processed successfully for adventure ${context.adventure?.id}`);
            } catch (displayError) {
                logger.error('Error displaying response:' + formatGenericOutput(JSON.stringify(displayError)));
                throw displayError;
            }

            // Add this after processing rewards
            if (parsedResponse.rewards?.length || parsedResponse.loot) {
                const characterService = new DefaultCharacterService();
                const updatedCharacter = await characterService.getCharacter(character.id);
                
                if (updatedCharacter) {
                    // Format and send character sheet update
                    const characterEmbed = formatCharacterSheet(updatedCharacter);
                    
                    // Find the character's channel in the category
                    if (interaction.guild && context.adventure?.categoryId) {
                        const category = interaction.guild.channels.cache.get(context.adventure.categoryId);
                        if (category?.type === ChannelType.GuildCategory) {
                            const characterChannel = category.children.cache.find(
                                (channel: { name: string; }) => 
                                    channel.name.toLowerCase() === `${character.name.toLowerCase()}-sheet`
                            );

                            if (characterChannel) {
                                await characterChannel.send({
                                    content: context.language === 'en-US'
                                        ? '📝 Character sheet updated!'
                                        : '📝 Ficha de personagem atualizada!',
                                    embeds: [characterEmbed]
                                });
                            }
                        }
                    }

                    // Add character sheet update to context
                    const updateMessage = context.language === 'en-US'
                        ? '📊 Character sheet has been updated with new rewards and items!'
                        : '📊 Ficha de personagem foi atualizada com novas recompensas e itens!';
                    
                    if (!context.additionalContext) {
                        context.additionalContext = [];
                    }
                    context.additionalContext.push(updateMessage);
                }
            }
        } catch (parseError) {
            logger.error('Error parsing AI response:' + formatGenericOutput(JSON.stringify(parseError)));
            throw parseError;
        }
    } catch (error) {
        logger.error('Error handling action response:' + formatGenericOutput(JSON.stringify(error)));
        try {
            if (interaction.deferred) {
                await interaction.editReply({ 
                    content: context.language === 'en-US' 
                        ? 'There was an error processing your action. Please try again.'
                        : 'Houve um erro ao processar sua ação. Por favor, tente novamente.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            logger.error('Error sending error message:' + formatGenericOutput(JSON.stringify(replyError)));
        }
        throw error;
    }
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        const description = interaction.options.getString('description', true);
        logger.debug(`User ${interaction.user.id} invoked /action with description: ${description}`);

        const dbUser = await prisma.user.findUnique({
            where: { discordId: interaction.user.id }
        });

        if (!dbUser) {
            await interaction.editReply({
                content: 'You need to register first using /register.',
            });
            return;
        }

        const adventure = await adventureService.getCurrentAdventure(dbUser.id);
        logger.debug(`Retrieved adventure for user ${dbUser.id}:`, prettyPrintLog(JSON.stringify(adventure)));

        if (!adventure) {
            await interaction.editReply({
                content: 'You need to be in an active adventure to perform actions.',
            });
            return;
        }

        try {
            const context = await adventureService.buildGameContext(adventure, description);
            const gameMaster = new GameMaster(context.adventure?.id || '');
            const response = await gameMaster.generateResponse(context);
            await handleActionResponse(interaction, context, description);
        } catch (aiError) {
            logger.error('Error generating AI response:\n' + aiError);
            await interaction.editReply({
                content: 'Sorry, I had trouble processing your action. Please try again.',
            });
        }
    } catch (error) {
        logger.error('Error in player action command:\n' + error);
        if (interaction.deferred) {
            await interaction.editReply({
                content: translate('errors.generic'),
            });
        } else {
            await interaction.reply({
                content: translate('errors.generic'),
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

export async function handleButtonAction(interaction: any, action: string) {
    try {
        await interaction.deferReply();
        
        // Extract the action text from the button that was clicked
        const clickedButton = interaction.message.components[0].components.find(
            (button: any) => button.customId === interaction.customId
        );
        
        if (!clickedButton) {
            throw new Error('Button not found');
        }

        const actionText = clickedButton.label;
        logger.debug(`Button action received. \n\n${chalk.blue('ACTION: ') + actionText}\n`);

        // Get the message that contains the buttons
        const message = await interaction.message.fetch();
        
        // Create new button components based on the existing ones
        const components = message.components[0].components.map((button: any) => ({
            type: 2,
            style: button.customId === interaction.customId ? ButtonStyle.Success : ButtonStyle.Secondary,
            label: button.label,
            custom_id: button.customId,
            disabled: true
        }));

        // Update the message with the new button states
        await message.edit({
            embeds: message.embeds,
            components: [{
                type: 1,
                components
            }]
        });

        const userAdventure = await prisma.adventure.findFirst({
            where: { 
                players: {
                    some: {
                        character: {
                            user: {
                                discordId: interaction.user.id
                            }
                        }
                    }
                }
            },
            include: {
                players: {
                    include: {
                        character: {
                            include: {
                                user: true,
                                CharacterSpell: true,
                                CharacterAbility: true
                            }
                        }
                    }
                }
            }
        });

        if (!userAdventure) {
            await interaction.editReply({
                content: 'You need to be in an active adventure to perform actions.',
            });
            return;
        }

        const context = await adventureService.buildGameContext(userAdventure as unknown as Adventure, actionText);
        await handleActionResponse(interaction, context, actionText);
    } catch (error) {
        logger.error('Error handling button action:\n' + error);
        await interaction.editReply({ 
            content: 'There was an error processing your action.', 
            flags: MessageFlags.Ephemeral
        });
    }
}

export function extractSuggestedActions(response: string): string[] {
    try {
        // Find the [Actions] section
        const actionsMatch = response.match(/\[Actions\]([^[]*)/i);
        if (!actionsMatch) {
            // Try Portuguese section name
            const acoesMatch = response.match(/\[Ações\]([^[]*)/i);
            if (!acoesMatch) return [];
            return extractActionItems(acoesMatch[1]);
        }
        return extractActionItems(actionsMatch[1]);
    } catch (error) {
        logger.error('Error extracting actions:\n' + error);
        return [];
    }
}

function extractActionItems(actionsText: string): string[] {
    // Split by newlines and filter for lines starting with dash/hyphen
    return actionsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'))
        .map(line => line.substring(1).trim()) // Remove the dash and trim
        .filter(action => action.length > 0)
        .slice(0, 5); // Discord limit of 5 buttons
}

async function getEmojiForAction(action: string, language: string = 'en-US'): Promise<string> {
    try {
        const vectorStore = VectorStore.getInstance();
        let highestSimilarity = -1;
        let bestCategory = "default";

        // Get concepts for the current language
        const languageConcepts = ACTION_CONCEPTS[language as keyof typeof ACTION_CONCEPTS] || ACTION_CONCEPTS['en-US'];

        // Compare action text with each category's concepts
        for (const [category, data] of Object.entries(languageConcepts)) {
            const { similarity } = await vectorStore.compareWithConcepts(action, data.concepts);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestCategory = category;
            }
        }

        // Only use the category if similarity is above threshold
        return highestSimilarity > 0.3 
            ? languageConcepts[bestCategory as keyof typeof languageConcepts].emoji 
            : "➡️";
    } catch (error) {
        logger.error('Error getting emoji for action:' + formatGenericOutput(JSON.stringify(error)));
        return "➡️";
    }
}

async function createActionButtons(actions: GameAction[], language: string = 'en-US'): Promise<any[]> {
    const buttons = await Promise.all(actions.map(async action => {
        let style = ButtonStyle.Primary; // Default blue
        
        if (action.type === ActionType.QUESTION) {
            style = ButtonStyle.Secondary;
        } else if (action.type === ActionType.COMBAT) {
            style = ButtonStyle.Danger;
        }

        const emoji = await getEmojiForAction(action.text, language);
        const buttonId = `action_${action.type}_${uuidv4()}`;
        
        // Properly truncate text to 80 characters with ellipsis if needed
        const truncatedText = action.text.length > 80 
            ? action.text.substring(0, 77) + '...'
            : action.text;

        return {
            type: 2,
            style,
            label: truncatedText,
            emoji: emoji,
            custom_id: buttonId
        };
    }));

    return buttons;
}

export function toGameCharacter(character: any) {
    // Convert database character to game character format
    return {
        // Implementation...
    };
}

export async function getAdventureMemory(adventureId: string) {
    // Get adventure memory entries
    // Implementation...
    return [];
}

export { handleRollAction };

function safeDestroyConnection(connection: VoiceConnection, guildId: string) {
    try {
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
        activeConnections.delete(guildId);
    } catch (error) {
        logger.error('Error safely destroying connection:' + formatGenericOutput(JSON.stringify(error)));
    }
} 