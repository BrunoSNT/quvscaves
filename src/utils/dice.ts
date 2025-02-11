export function calculateModifier(stat: number): number {
    return Math.floor((stat - 10) / 2);
}

export function calculateHealth(level: number, constitution: number, characterClass: string): number {
    const constitutionModifier = calculateModifier(constitution);
    const hitDice = getHitDiceForClass(characterClass);
    
    // First level gets maximum HP
    let health = hitDice + constitutionModifier;
    
    // Additional levels roll or take average
    for (let i = 1; i < level; i++) {
        // Using average HP per level for consistency
        health += Math.floor(hitDice / 2) + 1 + constitutionModifier;
    }
    
    return health;
}

export function getHitDiceForClass(characterClass: string): number {
    switch (characterClass.toLowerCase()) {
        case 'barbarian': return 12;
        case 'fighter':
        case 'paladin':
        case 'ranger': return 10;
        case 'cleric':
        case 'druid':
        case 'monk':
        case 'rogue':
        case 'warlock': return 8;
        case 'mage':
        case 'sorcerer':
        case 'wizard': return 6;
        default: return 8;
    }
}

export function getRacialBonuses(race: string): {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
    languages: string[];
} {
    switch (race.toLowerCase()) {
        case 'human':
            return {
                strength: 1,
                dexterity: 1,
                constitution: 1,
                intelligence: 1,
                wisdom: 1,
                charisma: 1,
                languages: ['Common', 'Choice']
            };
        case 'elf':
            return {
                dexterity: 2,
                wisdom: 1,
                languages: ['Common', 'Elvish']
            };
        case 'dwarf':
            return {
                constitution: 2,
                strength: 1,
                languages: ['Common', 'Dwarvish']
            };
        case 'halfling':
            return {
                dexterity: 2,
                charisma: 1,
                languages: ['Common', 'Halfling']
            };
        case 'orc':
            return {
                strength: 2,
                constitution: 1,
                languages: ['Common', 'Orc']
            };
        default:
            return {
                languages: ['Common']
            };
    }
}

export function getStartingProficiencies(characterClass: string): string[] {
    switch (characterClass.toLowerCase()) {
        case 'warrior':
            return ['All Armor', 'Shields', 'Simple Weapons', 'Martial Weapons'];
        case 'mage':
            return ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light Crossbows'];
        case 'rogue':
            return ['Light Armor', 'Simple Weapons', 'Hand Crossbows', 'Rapiers', 'Shortswords'];
        case 'cleric':
            return ['Light Armor', 'Medium Armor', 'Shields', 'Simple Weapons'];
        case 'ranger':
            return ['Light Armor', 'Medium Armor', 'Shields', 'Simple Weapons', 'Martial Weapons'];
        case 'paladin':
            return ['All Armor', 'Shields', 'Simple Weapons', 'Martial Weapons'];
        default:
            return ['Simple Weapons'];
    }
}

type CharacterClass = 'mage' | 'cleric' | 'ranger' | 'paladin' | 'warrior' | 'rogue';
type Race = 'human' | 'elf' | 'dwarf' | 'halfling' | 'orc';

export function calculateMana(level: number, intelligence: number, wisdom: number, characterClass: string): number {
    const baseStats: Record<CharacterClass, number> = {
        mage: 100,
        cleric: 80,
        ranger: 50,
        paladin: 60,
        warrior: 20,
        rogue: 30
    };

    const intMod = Math.floor((intelligence - 10) / 2);
    const wisMod = Math.floor((wisdom - 10) / 2);
    
    const base = baseStats[characterClass.toLowerCase() as CharacterClass] || 50;
    const perLevel = characterClass.toLowerCase() === 'mage' ? 20 : 10;
    
    return base + (perLevel * (level - 1)) + (intMod * 5) + (wisMod * 5);
}

export function calculateArmorClass(dexterity: number, characterClass: string): number {
    const baseAC = 10;
    const dexMod = Math.floor((dexterity - 10) / 2);
    
    const classBonus: Record<CharacterClass, number> = {
        warrior: 2,
        paladin: 2,
        cleric: 1,
        ranger: 1,
        rogue: 0,
        mage: 0
    };
    
    return baseAC + dexMod + (classBonus[characterClass.toLowerCase() as CharacterClass] || 0);
}

export function getRaceSpeed(race: string): number {
    const speeds: Record<Race, number> = {
        human: 30,
        elf: 35,
        dwarf: 25,
        halfling: 25,
        orc: 35
    };
    
    return speeds[race.toLowerCase() as Race] || 30;
} 