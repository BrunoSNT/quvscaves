import { ChatInputCommandInteraction, MessagePayload, InteractionReplyOptions, TextChannel, DMChannel, NewsChannel, ThreadChannel, BaseGuildTextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, EmbedBuilder } from 'discord.js';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getMessages } from '../../utils/language';
import { SupportedLanguage, GameContext, GameState, CharacterClass, Character, WorldStyle, ToneStyle, MagicLevel } from '../../types/game';
import { generateResponse } from '../../ai/gamemaster';
import { getActiveAdventure } from '../../lib/adventure';
import { getAdventureMemory as getMemory } from '../../lib/memory';
import { sendFormattedResponse } from '../../utils/discord/embeds';
import { ParsedEffects, StatusEffect } from 'utils';

export function parseEffects(effectsText: string): ParsedEffects {
    const effects: StatusEffect[] = [];
    const result: ParsedEffects = { 
        statusEffects: effects, 
        healthChange: 0, 
        manaChange: 0,
        experienceChange: 0
    };
    
    // Add combat effect parsing
    const combatStartRegex = /iniciando combate|combat begins|initiative order/i;
    const combatEndRegex = /combate termina|combat ends|battle is over/i;
    
    if (combatStartRegex.test(effectsText)) {
        result.combatAction = 'start';
    } else if (combatEndRegex.test(effectsText)) {
        result.combatAction = 'end';
    }

    // Match status effects like "+2 Intriga" or "Alerta: +3"
    const statusRegex = /\+(\d+)\s+([^,\n]+)|(\w+):\s*\+(\d+)/g;
    let match;
    while ((match = statusRegex.exec(effectsText)) !== null) {
        const value = parseInt(match[1] || match[4]);
        const name = match[2] || match[3];
        if (name && !isNaN(value)) {
            effects.push({
                name: name.trim(),
                value: value,
                type: determineEffectType(name)
            });
        }
    }

    // Match health changes (both gains and losses)
    const healthGainRegex = /recuperando (\d+) pontos de vida/i;
    const healthLossRegex = /perder (\d+) pontos de vida/i;
    const absoluteHealthRegex = /vida:?\s*(\d+)/i;
    
    const healthGainMatch = effectsText.match(healthGainRegex);
    const healthLossMatch = effectsText.match(healthLossRegex);
    const absoluteHealthMatch = effectsText.match(absoluteHealthRegex);
    
    if (healthGainMatch) {
        result.healthChange = parseInt(healthGainMatch[1]);
    } else if (healthLossMatch) {
        result.healthChange = -parseInt(healthLossMatch[1]);
    } else if (absoluteHealthMatch) {
        result.absoluteHealth = parseInt(absoluteHealthMatch[1]);
    }

    // Match mana changes
    const manaChangeRegex = /(\d+) pontos de mana/i;
    const absoluteManaRegex = /mana:?\s*(\d+)/i;
    const manaMatch = effectsText.match(manaChangeRegex);
    const absoluteManaMatch = effectsText.match(absoluteManaRegex);

    if (manaMatch) {
        result.manaChange = effectsText.toLowerCase().includes('consumiu') ? -parseInt(manaMatch[1]) : parseInt(manaMatch[1]);
    } else if (absoluteManaMatch) {
        result.absoluteMana = parseInt(absoluteManaMatch[1]);
    }

    // Match experience changes
    const xpRegex = /(\+|-)?\s*(\d+)\s*(xp|experiência)/i;
    const xpMatch = effectsText.match(xpRegex);
    if (xpMatch) {
        const multiplier = xpMatch[1] === '-' ? -1 : 1;
        result.experienceChange = multiplier * parseInt(xpMatch[2]);
    }

    return result;
}

function determineEffectType(effectName: string): 'positive' | 'negative' | 'neutral' {
    const positiveEffects = ['alerta', 'força', 'proteção', 'inspiração'];
    const negativeEffects = ['veneno', 'medo', 'fraqueza', 'confusão'];
    
    effectName = effectName.toLowerCase();
    if (positiveEffects.some(effect => effectName.includes(effect))) return 'positive';
    if (negativeEffects.some(effect => effectName.includes(effect))) return 'negative';
    return 'neutral';
}

export function toGameCharacter(dbChar: any): Character {
    return {
        id: dbChar.id,
        name: dbChar.name,
        class: dbChar.class as CharacterClass,
        race: dbChar.race || 'unknown',
        level: dbChar.level || 1,
        experience: dbChar.experience || 0,
        strength: dbChar.strength || 10,
        dexterity: dbChar.dexterity || 10,
        constitution: dbChar.constitution || 10,
        intelligence: dbChar.intelligence || 10,
        wisdom: dbChar.wisdom || 10,
        charisma: dbChar.charisma || 10,
        health: dbChar.health || 100,
        maxHealth: dbChar.maxHealth || 100,
        mana: dbChar.mana || 100,
        maxMana: dbChar.maxMana || 100,
        armorClass: dbChar.armorClass || 10,
        initiative: dbChar.initiative || 0,
        speed: dbChar.speed || 30,
        proficiencies: dbChar.proficiencies || [],
        languages: dbChar.languages || [],
        spells: dbChar.spells || [],
        abilities: dbChar.abilities || [],
        inventory: dbChar.inventory || []
    };
}

export async function getAdventureMemory(adventureId: string) {
    // Get current scene and recent scenes
    const scenes = await prisma.scene.findMany({
        where: { adventureId },
        orderBy: { createdAt: 'desc' },
        take: 5  // Get last 5 scenes
    });

    // Get significant memories
    const memories = await prisma.adventureMemory.findMany({
        where: { 
            adventureId,
            importance: { gte: 3 }  // Only get important memories
        },
        orderBy: { updatedAt: 'desc' }
    });

    // Helper function to clean section tags
    const cleanSectionTags = (text: string) => {
        return text.replace(/\[(Narration|Atmosphere|Dialogue|Effects|Actions|Memory)\]\s*/g, '');
    };

    // Organize memories by type
    const significantMemories = memories.filter(m => m.importance >= 4);
    const activeQuests = memories.filter(m => m.type === 'QUEST' && m.status === 'ACTIVE');
    const knownCharacters = memories.filter(m => m.type === 'CHARACTER');
    const discoveredLocations = memories.filter(m => m.type === 'LOCATION');
    const importantItems = memories.filter(m => m.type === 'ITEM');

    return {
        currentScene: scenes[0] ? {
            description: cleanSectionTags(scenes[0].description),
            summary: cleanSectionTags(scenes[0].summary),
            keyEvents: scenes[0].keyEvents,
            npcInteractions: scenes[0].npcInteractions ? JSON.parse(scenes[0].npcInteractions as string) : {},
            decisions: scenes[0].decisions ? JSON.parse(scenes[0].decisions as string) : [],
            questProgress: scenes[0].questProgress ? JSON.parse(scenes[0].questProgress as string) : {},
            locationContext: scenes[0].locationContext || ''
        } : {
            description: '',
            summary: '',
            keyEvents: [],
            npcInteractions: {},
            decisions: [],
            questProgress: {},
            locationContext: ''
        },
        recentScenes: scenes.slice(1).map(scene => ({
            description: cleanSectionTags(scene.description),
            summary: cleanSectionTags(scene.summary),
            keyEvents: scene.keyEvents,
            npcInteractions: scene.npcInteractions ? JSON.parse(scene.npcInteractions as string) : {},
            decisions: scene.decisions ? JSON.parse(scene.decisions as string) : [],
            questProgress: scene.questProgress ? JSON.parse(scene.questProgress as string) : {},
            locationContext: scene.locationContext || ''
        })),
        significantMemories,
        activeQuests,
        knownCharacters,
        discoveredLocations,
        importantItems
    };
}

async function updateAdventureMemory(adventureId: string, aiResponse: string) {
    // Extract memory updates from AI response
    const memorySection = aiResponse.match(/\[Memory\](.*?)(?=\[|$)/s)?.[1].trim();
    if (!memorySection) return;

    try {
        // Find the most recent scene
        const recentScene = await prisma.scene.findFirst({
            where: { adventureId },
            orderBy: { createdAt: 'desc' }
        });

        if (recentScene) {
            // Update the scene with the memory text
            await prisma.scene.update({
                where: { id: recentScene.id },
                data: {
                    keyEvents: [memorySection], // Store the memory text as a key event
                }
            });
        }
    } catch (error) {
        logger.error('Error updating adventure memory:', error);
    }
}

export function extractSuggestedActions(response: string, language: SupportedLanguage): string[] {
    const actionSection = language === 'pt-BR' 
        ? /\[(?:Sugestões de Ação|Ações Disponíveis|Ações)\](.*?)(?=\[|$)/s
        : /\[(?:Available Actions|Actions|Suggested Actions)\](.*?)(?=\[|$)/s;

    const match = response.match(actionSection);
    if (!match) return [];

    return match[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.trim().replace(/^-\s*/, ''))
        .filter(action => action.length > 0);
}

export function createActionButtons(actions: string[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    
    // Create buttons in groups of 5 (Discord's limit per row)
    for (let i = 0; i < actions.length; i += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        const groupActions = actions.slice(i, i + 5);
        
        groupActions.forEach((action) => {
            const buttonLabel = action.length > 80 ? action.substring(0, 77) + '...' : action;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`action:${action}`) // Store the full action in the custom ID
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Primary)
            );
        });
        
        rows.push(row);
    }
    
    return rows;
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();
        
        const action = interaction.options.getString('description', true);
        logger.debug(`Processing action for user ${interaction.user.id}: ${action}`);
        
        const userAdventure = await getActiveAdventure(interaction.user.id);
        if (!userAdventure) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.needActiveAdventure,
            });
            return;
        }

        const userCharacter = userAdventure.players.find(
            p => p.character.user.discordId === interaction.user.id
        )?.character;

        if (!userCharacter) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.characterNotInAdventure,
            });
            return;
        }

        const gameCharacter = toGameCharacter(userCharacter);
        const memory = await getMemory(userAdventure.id);

        const context: GameContext = {
            scene: '',
            playerActions: [action],
            characters: [gameCharacter],
            currentState: {
                health: userCharacter.health,
                mana: userCharacter.mana,
                inventory: [],
                questProgress: userAdventure.status
            },
            language: userAdventure.language as SupportedLanguage || 'en-US',
            adventureSettings: {
                worldStyle: userAdventure.worldStyle as WorldStyle,
                toneStyle: userAdventure.toneStyle as ToneStyle,
                magicLevel: userAdventure.magicLevel as MagicLevel,
                setting: userAdventure.setting || undefined
            },
            memory
        };

        logger.debug('Generating AI response...');
        const response = await generateResponse(context);
        logger.debug('AI response generated');

        // Save the scene
        await prisma.scene.create({
            data: {
                adventureId: userAdventure.id,
                name: `Scene ${Date.now()}`,
                description: response,
                summary: response.split('\n')[0], // First line as summary
                keyEvents: [],
                npcInteractions: JSON.stringify({}),
                decisions: JSON.stringify([action]),
                questProgress: JSON.stringify({}),
                locationContext: ''
            }
        });

        // Update adventure memory based on AI response
        await updateAdventureMemory(userAdventure.id, response);
        
        const channel = interaction.channel;
        if (!channel || !(channel instanceof BaseGuildTextChannel)) {
            await interaction.editReply({
                content: 'This command can only be used in a server text channel.',
            });
            return;
        }

        // Send formatted response
        await sendFormattedResponse({
            channel,
            characterName: userCharacter.name,
            action,
            response,
            language: userAdventure.language as SupportedLanguage,
            voiceType: userAdventure.voiceType,
            guild: interaction.guild!,
            categoryId: userAdventure.categoryId || undefined,
            adventureId: userAdventure.id
        });

        await interaction.editReply({
            content: '✨ Ação processada!'
        });

    } catch (error) {
        logger.error('Error handling player action:', error);
        if (interaction.deferred) {
            await interaction.editReply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
            });
        } else {
            await interaction.reply({
                content: getMessages(interaction.locale as SupportedLanguage).errors.genericError,
                ephemeral: true
            });
        }
    }
} 