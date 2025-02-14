export type DiceRoll = {
    rolls: number[];
    total: number;
    modifier?: number;
    advantage?: boolean;
    disadvantage?: boolean;
};

export function rollDice(
    numberOfDice: number,
    diceSides: number,
    modifier: number = 0,
    advantage: boolean = false,
    disadvantage: boolean = false
): DiceRoll {
    if (advantage && disadvantage) {
        // They cancel each other out
        advantage = false;
        disadvantage = false;
    }

    const rolls: number[] = [];
    for (let i = 0; i < numberOfDice; i++) {
        rolls.push(Math.floor(Math.random() * diceSides) + 1);
    }

    if (advantage || disadvantage) {
        const secondRolls: number[] = [];
        for (let i = 0; i < numberOfDice; i++) {
            secondRolls.push(Math.floor(Math.random() * diceSides) + 1);
        }

        if (advantage) {
            rolls.forEach((roll, index) => {
                if (secondRolls[index] > roll) {
                    rolls[index] = secondRolls[index];
                }
            });
        } else { // disadvantage
            rolls.forEach((roll, index) => {
                if (secondRolls[index] < roll) {
                    rolls[index] = secondRolls[index];
                }
            });
        }
    }

    const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier;

    return {
        rolls,
        total,
        modifier,
        advantage,
        disadvantage
    };
}

export function rollD20(
    modifier: number = 0,
    advantage: boolean = false,
    disadvantage: boolean = false
): DiceRoll {
    return rollDice(1, 20, modifier, advantage, disadvantage);
}

export function rollD6(
    numberOfDice: number = 1,
    modifier: number = 0
): DiceRoll {
    return rollDice(numberOfDice, 6, modifier);
}

export function rollD8(
    numberOfDice: number = 1,
    modifier: number = 0
): DiceRoll {
    return rollDice(numberOfDice, 8, modifier);
}

export function rollD10(
    numberOfDice: number = 1,
    modifier: number = 0
): DiceRoll {
    return rollDice(numberOfDice, 10, modifier);
}

export function rollD12(
    numberOfDice: number = 1,
    modifier: number = 0
): DiceRoll {
    return rollDice(numberOfDice, 12, modifier);
}

export function rollD100(): DiceRoll {
    return rollDice(1, 100);
}

export function formatRollResult(roll: DiceRoll): string {
    let result = `[${roll.rolls.join(', ')}]`;
    
    if (roll.modifier) {
        const sign = roll.modifier > 0 ? '+' : '';
        result += ` ${sign}${roll.modifier}`;
    }
    
    if (roll.advantage) {
        result += ' (with advantage)';
    } else if (roll.disadvantage) {
        result += ' (with disadvantage)';
    }
    
    result += ` = ${roll.total}`;
    
    return result;
} 