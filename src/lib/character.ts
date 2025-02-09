import { prisma } from './prisma';

export type DBCharacter = {
    id: string;
    name: string;
    class: string;
    race: string;
    level: number;
    experience: number;
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    armorClass: number;
    initiative: number;
    speed: number;
    proficiencies: string[];
    languages: string[];
    spells: any[];
    abilities: any[];
    inventory: any[];
    user: {
        discordId: string;
    };
};

export async function getCharacter(userId: string): Promise<DBCharacter | null> {
    return prisma.character.findFirst({
        where: {
            user: {
                discordId: userId
            }
        },
        include: {
            spells: true,
            abilities: true,
            inventory: true,
            user: true
        }
    });
} 