import { TextChannel, EmbedBuilder } from 'discord.js';
import { Character, Prisma } from '../../prisma/client';
import { logger } from './logger';

export interface StatusEffect {
    name: string;
    value: number;
    type: 'positive' | 'negative' | 'neutral';
}

export interface ParsedEffects {
    statusEffects: StatusEffect[];
    healthChange: number;
    manaChange: number;
    experienceChange: number;
    absoluteHealth?: number;
    absoluteMana?: number;
    combatAction?: 'start' | 'end';
}

const CLASS_COLORS = {
    warrior: 0xFF4444,    // Red
    mage: 0x44AAFF,      // Blue
    rogue: 0x44FF44,     // Green
    cleric: 0xFFAA44,    // Orange
    ranger: 0x44FFAA,    // Teal
    paladin: 0xFFFF44     // Yellow
} as const;

const CLASS_THUMBNAILS = {
    warrior: 'https://i.imgur.com/O5IopJh.jpeg',  // Warrior/Fighter icon
    mage: 'https://i.imgur.com/zdNccaF.jpeg',     // Mage/Wizard icon
    rogue: 'https://i.imgur.com/cCwRIqs.jpeg',    // Rogue/Thief icon
    cleric: 'https://i.imgur.com/v91nQW5.jpeg',   // Cleric/Priest icon
    ranger: 'https://i.imgur.com/Nfbganl.jpeg',   // Ranger/Hunter icon
    paladin: 'https://i.imgur.com/v2SaOqi.jpeg'   // Paladin icon
} as const;

function getClassColor(characterClass: string): number {
    return CLASS_COLORS[characterClass.toLowerCase() as keyof typeof CLASS_COLORS] || 0x2B2D31;
}

function getStatusEmoji(type: 'positive' | 'negative' | 'neutral'): string {
    switch (type) {
        case 'positive': return '🟢';
        case 'negative': return '🔴';
        case 'neutral': return '🔵';
    }
}

function getModifierString(stat: number): string {
    const modifier = Math.floor((stat - 10) / 2);
    if (modifier === 0) return '';
    const sign = modifier > 0 ? '+' : '';
    return modifier > 0 
        ? ` \`+${modifier}\``  // Green for positive
        : `\`${modifier}\``   // Red for negative
}

function formatStats(character: Character): string {
    const formatStat = (value: number) => `${value.toString().padStart(2)}${getModifierString(value)}`;
    return `\nSTR: ${formatStat(character.strength)}
DEX: ${formatStat(character.dexterity)}
CON: ${formatStat(character.constitution)}
INT: ${formatStat(character.intelligence)}
WIS: ${formatStat(character.wisdom)}
CHA: ${formatStat(character.charisma)}`;
}

function formatCombatStats(character: Character): string {
    const currentHealth = Math.min(character.health, character.maxHealth);
    const currentMana = Math.min(character.mana, character.maxMana);

    return `\n❤️ HP: ${currentHealth.toString().padStart(3)}/${character.maxHealth.toString().padStart(3)} \n 🔮 MP: ${currentMana.toString().padStart(3)}/${character.maxMana.toString().padStart(3)}
🛡️ AC: ${character.armorClass.toString().padStart(2)} \n ⚡ Init: ${character.initiative.toString().padStart(2)} \n 👣 Speed: ${character.speed}ft`;
}

function formatInventory(items: any[] = []): string {
    if (items.length === 0) return '_Empty_';
    return items.map(item => `• ${item.name} ${item.quantity > 1 ? `(${item.quantity})` : ''}`).join('\n');
}

function formatSpells(spells: any[] = []): string {
    // Temporary example spells until we implement proper spell system
    const defaultSpells = [
        '• 🔥 Sacred Flame (Cantrip)',
        '• ✨ Light (Cantrip)',
        '• 💕 Cure Wounds (1st)',
        '• 🛡️ Shield of Faith (1st)'
    ];
    return spells.length > 0 ? spells.join('\n') : defaultSpells.join('\n');
}

function formatAbilities(abilities: any[] = []): string {
    // Temporary example abilities until we implement proper ability system
    const defaultAbilities = [
        '• 🙏 Turn Undead',
        '• 📿 Divine Domain',
        '• ✝️ Channel Divinity',
        '• 🌟 Divine Intervention'
    ];
    return abilities.length > 0 ? abilities.join('\n') : defaultAbilities.join('\n');
}

function formatStatusEffects(effects: StatusEffect[]): string {
    if (effects.length === 0) return '_None_';
    return effects.map(effect => {
        const emoji = getStatusEmoji(effect.type);
        const padding = ' '.repeat(30 - effect.name.length);  // Dynamic padding based on name length
        return `${emoji} **${effect.name}**${padding}${effect.value > 0 ? '+' : ''}${effect.value}`;
    }).join('\n\n');
}

function createProgressBar(current: number, max: number, size: number = 50): string {
    const progress = Math.min(Math.floor((current / max) * size), size);
    const filled = '█'.repeat(progress);
    const empty = '▒'.repeat(size - progress);
    const percent = Math.floor((current / max) * 100);
    return `${filled}${empty}  ${percent}%`;
}

function getXPForNextLevel(level: number): number {
    return level * 1000; // Simple XP calculation, adjust as needed
}

type CharacterWithRelations = Prisma.CharacterGetPayload<{
    include: {
        spells: true;
        abilities: true;
        inventory: true;
    }
}>;

export function formatCharacterSheet(character: CharacterWithRelations, statusEffects: StatusEffect[] = []): EmbedBuilder {
    const nextLevelXP = getXPForNextLevel(character.level);
    const xpProgress = createProgressBar(character.experience % nextLevelXP, nextLevelXP);
    const classColor = getClassColor(character.class);
    const thumbnailUrl = CLASS_THUMBNAILS[character.class.toLowerCase() as keyof typeof CLASS_THUMBNAILS] || 'https://i.imgur.com/AfFp7pu.png';

    const embed = new EmbedBuilder()
        .setTitle(`${character.name}`)
        .setDescription(`Level ${character.level} ${character.race} ${character.class}\n\u200B`)
        .setColor(classColor)
        .setThumbnail(thumbnailUrl)
        .addFields(
            // Left Side
            { 
                name: '📊 Base Stats',
                value: formatStats(character),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: true }, // Spacer Spacer
            {
                name: '⚔️ Combat',
                value: formatCombatStats(character),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer

            // Second Row - Left Side
            {
                name: '🎯 Proficiencies',
                value: character.proficiencies.map(p => `• ${p}`).join('\n'),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: true }, // Spacer
            {
                name: '🗣️ Languages',
                value: character.languages.map(l => `• ${l}`).join('\n'),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer

            // Right Side Column (Spells & Abilities)
            {
                name: '📚 Spells',
                value: formatSpells(character.spells || []),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: true }, // Spaceracer
            {
                name: '⚡ Abilities',
                value: formatAbilities(character.abilities || []),
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer

            // Full Width Sections
            {
                name: '✨ Status Effects',
                value: formatStatusEffects(statusEffects),
                inline: false
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer
            {
                name: '🎒 Inventory',
                value: formatInventory(character.inventory || []),
                inline: false
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer
            {
                name: '📈 Experience',
                value: `\`${xpProgress}\`\n${character.experience % nextLevelXP}/${nextLevelXP} XP to next level`,
                inline: false
            },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer

        )
        .setFooter({ text: 'Last updated' })
        .setTimestamp();
    return embed;
}

export async function updateCharacterSheet(
    character: CharacterWithRelations, 
    channel: TextChannel, 
    statusEffects: StatusEffect[] = []
): Promise<void> {
    try {
        const pins = await channel.messages.fetchPinned();
        const existingSheet = pins.find(msg => 
            msg.author.id === msg.client.user!.id && 
            msg.embeds.length > 0 &&
            msg.embeds[0].title === character.name
        );

        const embed = formatCharacterSheet(character, statusEffects);

        if (existingSheet) {
            await existingSheet.edit({ embeds: [embed] });
        } else {
            const newSheet = await channel.send({ embeds: [embed] });
            await newSheet.pin();
        }
    } catch (error) {
        logger.error('Error updating character sheet:', error);
    }
}

export interface Spell {
    id: string;
    name: string;
    level: number;
    school: string;
    description: string;
    castingTime: string;
    range: string;
    duration: string;
    components: string[];
}

export interface Ability {
    id: string;
    name: string;
    type: string;
    description: string;
    uses: number;
    recharge: string;
}

export interface Item {
    id: string;
    name: string;
    type: string;
    description: string;
    quantity: number;
    weight: number;
    value: number;
}

export type CharacterClass = 'warrior' | 'mage' | 'rogue' | 'cleric' | 'ranger' | 'paladin';

export interface GameCharacter extends Character {
    spells?: Spell[];
    abilities?: Ability[];
    inventory?: Item[];
}

export interface AdventurePlayerWithCharacter {
    id: string;
    adventureId: string;
    character: GameCharacter;
    createdAt: Date;
    updatedAt: Date;
} 