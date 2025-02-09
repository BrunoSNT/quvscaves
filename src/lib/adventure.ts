import { prisma } from './prisma';

export type Adventure = {
    id: string;
    name: string;
    status: string;
    language: string;
    worldStyle: string;
    toneStyle: string;
    magicLevel: string;
    setting: string | null;
    players: {
        character: {
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
    }[];
};

export async function getActiveAdventure(userId: string): Promise<Adventure | null> {
    return prisma.adventure.findFirst({
        where: { 
            status: 'ACTIVE',
            players: {
                some: {
                    character: {
                        user: {
                            discordId: userId
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
                            spells: true,
                            abilities: true,
                            inventory: true
                        }
                    }
                }
            }
        }
    });
} 