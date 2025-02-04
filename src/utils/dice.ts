export function rollDice(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
}

export function roll4d6DropLowest(): number {
    const rolls = Array(4).fill(0).map(() => rollDice(6));
    rolls.sort((a, b) => b - a); // Sort descending
    return rolls.slice(0, 3).reduce((sum, num) => sum + num, 0); // Sum highest 3
}

export function generateStats(method: 'roll' | 'standard' | 'point_buy'): {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
} {
    switch (method) {
        case 'roll':
            return {
                strength: roll4d6DropLowest(),
                dexterity: roll4d6DropLowest(),
                constitution: roll4d6DropLowest(),
                intelligence: roll4d6DropLowest(),
                wisdom: roll4d6DropLowest(),
                charisma: roll4d6DropLowest()
            };
        case 'standard':
            return {
                strength: 15,
                dexterity: 14,
                constitution: 13,
                intelligence: 12,
                wisdom: 10,
                charisma: 8
            };
        case 'point_buy':
            // Default balanced distribution for 27 points
            return {
                strength: 13,
                dexterity: 13,
                constitution: 13,
                intelligence: 12,
                wisdom: 12,
                charisma: 12
            };
    }
}

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