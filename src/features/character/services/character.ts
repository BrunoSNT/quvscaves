import { prisma } from '../../../core/prisma';
import { Character, CharacterCreationOptions, CharacterService } from '../types';
import { logger } from '../../../shared/logger';
import { generateDefaultStats, generateDefaultSkills } from '../../../shared/game/defaults';
import { GameStats, GameSkills, GameInventoryItem, GameEffect, GameReward } from '../../../shared/game/types';

export class DefaultCharacterService implements CharacterService {
    async createCharacter(
        userId: string,
        options: CharacterCreationOptions
    ): Promise<Character> {
        // Ensure the user is registered.
        const user = await prisma.user.findUnique({
            where: { discordId: userId }
        });
        if (!user) {
            throw new Error('User not registered. Please register before creating a character.');
        }
        try {
            const character = await prisma.character.create({
                data: {
                    name: options.name,
                    class: options.class,
                    race: options.race,
                    level: 1,
                    experience: 0,
                    health: 100,
                    maxHealth: 100,
                    mana: 100,
                    maxMana: 100,
                    stats: options.stats || generateDefaultStats(),
                    skills: options.skills || generateDefaultSkills(),
                    inventory: [],
                    effects: [],
                    user: {
                        connect: { discordId: userId }
                    },
                    proficiencies: [],
                    languages: [],
                    background: options.background || '',
                }
            });

            logger.info(`Created character ${character.id} for user ${userId}`);
            return this.mapToCharacter(character);
        } catch (error) {
            logger.error('Error creating character:' + formatGenericOutput(JSON.stringify(error)));
            throw error;
        }
    }

    async getCharacter(id: string): Promise<Character | null> {
        const character = await prisma.character.findUnique({
            where: { id },
            include: {
                CharacterAbility: true,
                CharacterSpell: true
            }
        });

        if (!character) return null;

        return this.mapToCharacter(character);
    }

    async deleteCharacter(characterId: string, userId: string): Promise<void> {
        const character = await this.getCharacter(characterId);
        
        if (!character) {
            throw new Error('Character not found');
        }

        if (character.userId !== userId) {
            throw new Error('Not authorized to delete this character');
        }

        await prisma.character.delete({
            where: { id: characterId }
        });

        logger.info(`Deleted character ${characterId}`);
    }

    async updateCharacter(
        characterId: string,
        userId: string,
        updates: Partial<Character>
    ): Promise<Character> {
        const character = await this.getCharacter(characterId);
        
        if (!character) {
            throw new Error('Character not found');
        }

        if (character.userId !== userId) {
            throw new Error('Not authorized to update this character');
        }
        const updatedCharacter = await prisma.character.update({
            where: { id: characterId },
            data: {
              ...(updates as any),
            },
            include: {
                CharacterAbility: true,
                CharacterSpell: true
            }
        });

        return this.mapToCharacter(updatedCharacter);
    }

    async listCharacters(userId: string): Promise<Character[]> {
        const characters = await prisma.character.findMany({
            where: { userId },
            include: {
                CharacterAbility: true,
                CharacterSpell: true
            }
        });

        return characters.map(this.mapToCharacter);
    }

    private mapToCharacter(character: any): Character {
        return {
            ...character,
            stats: character.stats as GameStats,
            skills: character.skills as GameSkills,
            inventory: character.inventory as GameInventoryItem[],
            effects: character.effects as GameEffect[],
            proficiencies: character.proficiencies as string[],
            languages: character.languages as string[],
            spells: character.CharacterSpell,
            abilities: character.CharacterAbility,
            background: character.background || undefined,
        };
    }

    async addSpellToCharacter(
        characterId: string,
        spell: {
            name: string,
            level: number,
            school: string,
            description: string
        }
    ): Promise<Character> {
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                CharacterSpell: true,
                CharacterAbility: true
            }
        });

        if (!character) {
            throw new Error('Character not found');
        }

        // Add the spell
        await prisma.characterSpell.create({
            data: {
                ...spell,
                characterId
            }
        });

        // Fetch and return updated character
        const updatedCharacter = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                CharacterSpell: true,
                CharacterAbility: true
            }
        });

        return this.mapToCharacter(updatedCharacter!);
    }

    async addRewardsToCharacter(characterId: string, rewards: GameReward[]): Promise<Character> {
        const character = await prisma.character.findUnique({
            where: { id: characterId },
            include: {
                CharacterSpell: true,
                CharacterAbility: true
            }
        });

        if (!character) {
            throw new Error('Character not found');
        }

        let inventory = character.inventory as GameInventoryItem[];
        let experience = character.experience;
        let gold = 0;

        for (const reward of rewards) {
            switch (reward.type) {
                case 'ITEM':
                    if (reward.items) {
                        for (const item of reward.items) {
                            const existingItem = inventory.find(i => i.id === item.id);
                            if (existingItem) {
                                existingItem.quantity += item.quantity;
                            } else {
                                inventory.push(item);
                            }
                        }
                    }
                    break;

                case 'EXPERIENCE':
                    if (reward.experience) {
                        experience += reward.experience;
                        // Check for level up
                        const newLevel = Math.floor(experience / 1000) + 1;
                        if (newLevel > character.level) {
                            await this.handleLevelUp(character.id, newLevel);
                        }
                    }
                    break;

                case 'SPELL':
                    if (reward.spell) {
                        await prisma.characterSpell.create({
                            data: {
                                name: reward.spell.name,
                                level: reward.spell.level,
                                school: reward.spell.school,
                                description: reward.spell.description,
                                characterId: character.id
                            }
                        });
                    }
                    break;

                case 'ABILITY':
                    if (reward.ability) {
                        await prisma.characterAbility.create({
                            data: {
                                name: reward.ability.name,
                                type: reward.ability.type,
                                description: reward.ability.description,
                                uses: reward.ability.uses,
                                recharge: reward.ability.recharge,
                                characterId: character.id
                            }
                        });
                    }
                    break;

                case 'GOLD':
                    if (reward.gold) {
                        gold += reward.gold;
                        const goldItem = inventory.find(i => i.id === 'gold');
                        if (goldItem) {
                            goldItem.quantity += reward.gold;
                        } else {
                            inventory.push({
                                id: 'gold',
                                name: 'Gold',
                                description: 'Currency',
                                quantity: reward.gold,
                                type: 'MISC'
                            });
                        }
                    }
                    break;
            }
        }

        // Update character
        const updatedCharacter = await prisma.character.update({
            where: { id: character.id },
            data: {
                inventory,
                experience
            },
            include: {
                CharacterSpell: true,
                CharacterAbility: true
            }
        });

        return this.mapToCharacter(updatedCharacter);
    }

    private async handleLevelUp(characterId: string, newLevel: number): Promise<void> {
        const character = await prisma.character.findUnique({
            where: { id: characterId }
        });

        if (!character) {
            throw new Error('Character not found');
        }

        // Calculate new stats
        const stats = character.stats as GameStats;
        const maxHealth = calculateHealth(newLevel, stats.constitution, character.class);
        const maxMana = calculateMana(newLevel, stats.intelligence, stats.wisdom, character.class);

        await prisma.character.update({
            where: { id: characterId },
            data: {
                level: newLevel,
                maxHealth,
                health: maxHealth, // Heal to full on level up
                maxMana,
                mana: maxMana // Restore mana to full on level up
            }
        });
    }
} 