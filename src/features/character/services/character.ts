import { prisma } from '../../../core/prisma';
import { Character, CharacterCreationOptions, CharacterService } from '../types';
import { logger } from '../../../shared/logger';
import { generateDefaultStats, generateDefaultSkills } from '../../../shared/game/defaults';
import { GameStats, GameSkills, GameInventoryItem, GameEffect } from '../../../shared/types/game';

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
            logger.error('Error creating character:', error);
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
} 