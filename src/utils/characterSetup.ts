import { CharacterClass, WorldStyle, ToneStyle, MagicLevel } from '../types/game';
import { prisma } from '../lib/prisma';
import { logger } from './logger';

interface CharacterSetup {
    proficiencies: string[];
    languages: string[];
    spells?: {
        name: string;
        level: number;
        school: string;
        description: string;
        castingTime: string;
        range: string;
        duration: string;
        components: string[];
    }[];
    abilities?: {
        name: string;
        type: string;
        description: string;
        uses?: number;
        recharge?: string;
    }[];
}

// Update BASE_CLASS_PROFICIENCIES to match CharacterClass type
const BASE_CLASS_PROFICIENCIES: Record<CharacterClass, string[]> = {
    warrior: ['Simple Weapons', 'Martial Weapons', 'All Armor', 'Shields', 'Athletics', 'Intimidation'],
    mage: ['Daggers', 'Quarterstaffs', 'Light Crossbows', 'Arcana', 'History', 'Investigation'],
    rogue: ['Simple Weapons', 'Hand Crossbows', 'Rapiers', 'Shortswords', 'Light Armor', 'Stealth', 'Acrobatics'],
    ranger: ['Simple Weapons', 'Martial Weapons', 'Medium Armor', 'Shields', 'Nature', 'Survival'],
    paladin: ['Simple Weapons', 'Martial Weapons', 'All Armor', 'Shields', 'Religion', 'Persuasion']
};

// Update BASE_CLASS_ABILITIES to match CharacterClass type
const BASE_CLASS_ABILITIES: Record<CharacterClass, { name: string; type: string; description: string; }[]> = {
    warrior: [
        { name: 'Second Wind', type: 'class', description: 'Regain some hit points as a bonus action' },
        { name: 'Fighting Style', type: 'class', description: 'Adopt a particular style of fighting' }
    ],
    mage: [
        { name: 'Arcane Recovery', type: 'class', description: 'Recover some spell slots during a short rest' },
        { name: 'Spellcasting', type: 'class', description: 'Cast arcane spells using Intelligence' }
    ],
    rogue: [
        { name: 'Sneak Attack', type: 'class', description: 'Deal extra damage when you have advantage' },
        { name: 'Cunning Action', type: 'class', description: 'Take certain actions as a bonus action' }
    ],
    ranger: [
        { name: 'Natural Explorer', type: 'class', description: 'Be particularly familiar with one type of natural environment' },
        { name: 'Favored Enemy', type: 'class', description: 'Have significant experience studying a certain type of enemy' }
    ],
    paladin: [
        { name: 'Divine Sense', type: 'class', description: 'Detect strong evil and good' },
        { name: 'Lay on Hands', type: 'class', description: 'Restore a total number of hit points equal to paladin level × 5' }
    ]
};

const BASE_SPELLS: Record<CharacterClass, { 
    name: string; 
    level: number; 
    school: string;
    description: string;
    castingTime: string;
    range: string;
    duration: string;
    components: string[];
}[]> = {
    warrior: [],
    mage: [
        { 
            name: 'Fire Bolt', 
            level: 0, 
            school: 'Evocation',
            description: 'You hurl a mote of fire at a creature or object.',
            castingTime: '1 action',
            range: '120 feet',
            duration: 'Instantaneous',
            components: ['V', 'S']
        },
        { 
            name: 'Mage Hand', 
            level: 0, 
            school: 'Conjuration',
            description: 'A spectral, floating hand appears at a point you choose.',
            castingTime: '1 action',
            range: '30 feet',
            duration: '1 minute',
            components: ['V', 'S']
        },
        { 
            name: 'Magic Missile', 
            level: 1, 
            school: 'Evocation',
            description: 'You create three glowing darts of magical force.',
            castingTime: '1 action',
            range: '120 feet',
            duration: 'Instantaneous',
            components: ['V', 'S']
        },
        { 
            name: 'Shield', 
            level: 1, 
            school: 'Abjuration',
            description: 'An invisible barrier of magical force appears and protects you.',
            castingTime: '1 reaction',
            range: 'Self',
            duration: '1 round',
            components: ['V', 'S']
        }
    ],
    rogue: [],
    ranger: [
        { 
            name: 'Hunter\'s Mark', 
            level: 1, 
            school: 'Divination',
            description: 'You choose a creature you can see and mystically mark it as your quarry.',
            castingTime: '1 bonus action',
            range: '90 feet',
            duration: 'Concentration, up to 1 hour',
            components: ['V']
        }
    ],
    paladin: [
        { 
            name: 'Divine Smite', 
            level: 1, 
            school: 'Evocation',
            description: 'Channel divine energy into your weapon strikes.',
            castingTime: '1 bonus action',
            range: 'Self',
            duration: 'Concentration, up to 1 minute',
            components: ['V']
        },
        { 
            name: 'Bless', 
            level: 1, 
            school: 'Enchantment',
            description: 'You bless up to three creatures of your choice.',
            castingTime: '1 action',
            range: '30 feet',
            duration: 'Concentration, up to 1 minute',
            components: ['V', 'S', 'M']
        }
    ]
};

const RACE_LANGUAGES: Record<string, string[]> = {
    human: ['Common', 'Choice'],
    elf: ['Common', 'Elvish'],
    dwarf: ['Common', 'Dwarvish'],
    halfling: ['Common', 'Halfling'],
    orc: ['Common', 'Orc']
};

function adjustForMagicLevel(setup: CharacterSetup, magicLevel: MagicLevel): CharacterSetup {
    switch (magicLevel) {
        case 'none':
            setup.spells = [];
            setup.abilities = setup.abilities?.filter(a => !a.description.toLowerCase().includes('spell'));
            break;
        case 'low':
            setup.spells = setup.spells?.filter(s => s.level <= 1).slice(0, 2);
            break;
        case 'medium':
            setup.spells = setup.spells?.slice(0, 4);
            break;
        case 'high':
            // Keep all spells
            break;
    }
    return setup;
}

function adjustForWorldStyle(setup: CharacterSetup, worldStyle: WorldStyle): CharacterSetup {
    switch (worldStyle) {
        case 'steampunk':
            setup.proficiencies.push('Tinker\'s Tools');
            break;
        case 'dark_fantasy':
            setup.proficiencies.push('Survival');
            break;
        case 'mythological':
            setup.languages.push('Ancient');
            break;
        case 'post_apocalyptic':
            setup.proficiencies.push('Scavenging');
            break;
    }
    return setup;
}

function adjustForToneStyle(setup: CharacterSetup, toneStyle: ToneStyle): CharacterSetup {
    switch (toneStyle) {
        case 'gritty':
            setup.proficiencies.push('Survival');
            break;
        case 'political':
            setup.proficiencies.push('Persuasion', 'Deception');
            break;
        case 'horror':
            setup.proficiencies.push('Investigation');
            break;
    }
    return setup;
}

export async function setupCharacterForAdventure(
    characterId: string,
    adventureId: string
): Promise<void> {
    try {
        // Get character and adventure details
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                spells: true,
                abilities: true,
                inventory: true
            }
        });

        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId }
        });

        if (!character || !adventure) {
            throw new Error('Character or adventure not found');
        }

        // Start with base setup
        let setup: CharacterSetup = {
            proficiencies: [...BASE_CLASS_PROFICIENCIES[character.class as CharacterClass] || []],
            languages: [...RACE_LANGUAGES[character.race.toLowerCase()] || ['Common']],
            spells: [...BASE_SPELLS[character.class as CharacterClass] || []],
            abilities: [...BASE_CLASS_ABILITIES[character.class as CharacterClass] || []]
        };

        // Adjust based on adventure settings
        setup = adjustForMagicLevel(setup, adventure.magicLevel as MagicLevel);
        setup = adjustForWorldStyle(setup, adventure.worldStyle as WorldStyle);
        setup = adjustForToneStyle(setup, adventure.toneStyle as ToneStyle);

        // Update character in database
        await prisma.character.update({
            where: { id: characterId },
            data: {
                proficiencies: setup.proficiencies,
                languages: setup.languages,
                spells: {
                    deleteMany: {},
                    create: setup.spells?.map(spell => ({
                        name: spell.name,
                        level: spell.level,
                        school: spell.school,
                        description: spell.description || '',
                        castingTime: spell.castingTime || '1 action',
                        range: spell.range || '30 feet',
                        duration: spell.duration || 'Instantaneous',
                        components: spell.components || ['V', 'S']
                    }))
                },
                abilities: {
                    deleteMany: {},
                    create: setup.abilities?.map(ability => ({
                        name: ability.name,
                        type: ability.type,
                        description: ability.description,
                        uses: ability.uses,
                        recharge: ability.recharge
                    }))
                }
            }
        });

        logger.debug('Character setup completed:', {
            characterId,
            adventureId,
            proficienciesCount: setup.proficiencies.length,
            spellsCount: setup.spells?.length,
            abilitiesCount: setup.abilities?.length
        });

    } catch (error) {
        logger.error('Error setting up character:', error);
        throw error;
    }
} 