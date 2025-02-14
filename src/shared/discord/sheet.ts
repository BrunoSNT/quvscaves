import { EmbedBuilder } from 'discord.js';
import { Character } from '../../features/character/types';

// Helper function to calculate the XP for next level
function getXPForNextLevel(level: number): number {
  return level * 1000; // Simplified XP calculation—adjust as needed
}

// Helper function to create a textual progress bar
function createProgressBar(current: number, max: number, size: number = 20): string {
  const progress = Math.floor((current / max) * size);
  const bar = '█'.repeat(progress) + '▒'.repeat(size - progress);
  const percent = Math.floor((current / max) * 100);
  return `${bar} ${percent}%`;
}

// Define colors for each class
const CLASS_COLORS: Record<string, number> = {
  warrior: 0xff4444,
  mage: 0x44aaFF,
  rogue: 0x44FF44,
  cleric: 0xffaa44,
  ranger: 0x44ffaa,
  paladin: 0xffff44,
};

// Return the appropriate color for a given class
function getClassColor(characterClass: string): number {
  return CLASS_COLORS[characterClass.toLowerCase()] || 0x2b2d31;
}

// Define thumbnail URLs for each class
const CLASS_THUMBNAILS: Record<string, string> = {
  warrior: 'https://i.imgur.com/O5IopJh.jpeg',
  mage: 'https://i.imgur.com/zdNccaF.jpeg',
  rogue: 'https://i.imgur.com/cCwRIqs.jpeg',
  cleric: 'https://i.imgur.com/v91nQW5.jpeg',
  ranger: 'https://i.imgur.com/Nfbganl.jpeg',
  paladin: 'https://i.imgur.com/v2SaOqi.jpeg',
};

// Format the character's base stats.
// Assumes character.stats is an object like { strength, dexterity, ... }
function formatStats(character: Character): string {
  if (!character.stats) return 'No stats available';
  let output = '';
  for (const [key, value] of Object.entries(character.stats)) {
    const numValue = Number(value);
    const modifier = Math.floor((numValue - 10) / 2);
    const sign = modifier >= 0 ? '+' : '-';
    output += `${key.toUpperCase()}: ${numValue} (${sign}${Math.abs(modifier)})\n`;
  }
  return output.trim();
}

// Format combat-related stats
function formatCombatStats(character: Character): string {
  return `HP: ${character.health}/${character.maxHealth}\nMana: ${character.mana}/${character.maxMana}`;
}

// Format the character's inventory
function formatInventory(items: any[]): string {
  if (!items || items.length === 0) return '_Empty_';
  return items.map(item => `${item.name} x${item.quantity || 1}`).join('\n');
}

// Main function to format the character sheet as an embed
export function formatCharacterSheet(
  character: Character,
): EmbedBuilder {
  const nextLevelXP = getXPForNextLevel(character.level);
  const xpProgress = createProgressBar(character.experience % nextLevelXP, nextLevelXP);
  const classColor = getClassColor(character.class);
  const thumbnailUrl = CLASS_THUMBNAILS[character.class.toLowerCase()] || 'https://i.imgur.com/AfFp7pu.png';

  const embed = new EmbedBuilder()
    .setTitle(character.name)
    .setDescription(`Level ${character.level} ${character.race} ${character.class}\n\u200B`)
    .setColor(classColor)
    .setThumbnail(thumbnailUrl)
    .addFields(
      {
        name: '📊 Base Stats',
        value: formatStats(character),
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: true },
      {
        name: '⚔️ Combat',
        value: formatCombatStats(character),
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: false },
      {
        name: '🎯 Proficiencies',
        value: character.proficiencies && character.proficiencies.length > 0
          ? character.proficiencies.map(p => `• ${p}`).join('\n')
          : '_None_',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: true },
      {
        name: '🗣️ Languages',
        value: character.languages && character.languages.length > 0
          ? character.languages.map(l => `• ${l}`).join('\n')
          : '_None_',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: false },
      {
        name: '📚 Spells',
        value: character.spells && character.spells.length > 0
          ? character.spells.map(s => `• ${s.name} (${s.level === 0 ? 'Cantrip' : `Level ${s.level}`})`).join('\n')
          : '_None_',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: true },
      {
        name: '⚡ Abilities',
        value: character.abilities && character.abilities.length > 0
          ? character.abilities.map(a => `• ${a.name}`).join('\n')
          : '_None_',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: false },
      {
        name: '🎒 Inventory',
        value: formatInventory(character.inventory || []),
        inline: false,
      },
      { name: '\u200B', value: '\u200B', inline: false },
      {
        name: '📈 Experience',
        value: `\`${xpProgress}\`\n${character.experience % nextLevelXP}/${nextLevelXP} XP to next level`,
        inline: false,
      }
    )
    .setFooter({ text: 'Last updated' })
    .setTimestamp();

  return embed;
} 