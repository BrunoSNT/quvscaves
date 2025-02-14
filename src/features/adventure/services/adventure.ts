import { prisma } from '../../../core/prisma';
import { Adventure, AdventureSettings } from '../types';
import { logger } from '../../../shared/logger';
import { Character } from '../../character/types';
import { Prisma } from '@prisma/client';
import { GameStats } from '../../../shared/game/types';
import { SupportedLanguage } from '../../../shared/i18n/types';
import { GameContext } from '../../../shared/game/types';

interface PlayerInfo {
    userId: string;
    characterId: string;
    username: string;
}

export class AdventureService {
    async createAdventure(
        userId: string,
        name: string,
        settings: AdventureSettings,
        players: PlayerInfo[]
    ): Promise<Adventure> {
        try {
            const adventure = await prisma.adventure.create({
                data: {
                    name,
                    userId,
                    settings: settings as unknown as Prisma.InputJsonObject,
                    players: {
                        create: players.map(player => ({
                            user: {
                                connect: { id: player.userId }
                            },
                            character: {
                                connect: { id: player.characterId }
                            },
                            username: player.username,
                        })),
                    },
                    description: '',
                },
                include: {
                    players: {
                        include: {
                            user: true,
                            character: true,
                        },
                    },
                },
            });

            logger.info(`Created adventure ${adventure.id} for user ${userId}`);
            return this.mapToAdventure(adventure);
        } catch (error) {
            logger.error('Error creating adventure:', error);
            throw error;
        }
    }

    async getAdventure(adventureId: string): Promise<Adventure | null> {
        const adventure = await prisma.adventure.findUnique({
            where: { id: adventureId },
            include: {
                players: {
                    include: {
                        user: true,
                        character: true,
                    },
                },
            },
        });
        if(!adventure) return null;
        return this.mapToAdventure(adventure);
    }

    async deleteAdventure(adventureId: string, userId: string): Promise<void> {
        const adventure = await this.getAdventure(adventureId);
        
        if (!adventure) {
            throw new Error('Adventure not found');
        }

        if (adventure.userId !== userId) {
            throw new Error('Not authorized to delete this adventure');
        }

        // Delete dependent adventure players to satisfy foreign key constraints
        await prisma.adventurePlayer.deleteMany({
            where: { adventureId }
        });

        // Now delete the adventure record
        await prisma.adventure.delete({
            where: { id: adventureId }
        });

        logger.info(`Deleted adventure ${adventureId}`);
    }

    async processAction(
        adventureId: string,
        userId: string,
        action: string
    ): Promise<GameContext> {
        const adventure = await this.getAdventure(adventureId);
        if (!adventure) {
            throw new Error('Adventure not found');
        }
        // Find the player in the adventure
        const player = adventure.players.find(p => p.userId === userId);
        if (!player) {
            // This error could be mapped to the message "You need to be in an active adventure to perform actions."
            throw new Error('Player not found in this adventure');
        }

        const characters = await Promise.all(
            adventure.players.map(async (p) => {
                const character = await prisma.character.findUnique({
                    where: { id: p.characterId },
                    include: {
                        CharacterAbility: true,
                        CharacterSpell: true
                    }
                });
                return character;
            })
        );

        const validCharacters = characters.filter((c) => c !== null).map(this.mapToCharacter);

        const context: GameContext = {
            adventure,
            scene: adventure.description || '',
            characters: validCharacters,
            playerActions: [action],
            currentState: {
                health: 100,
                mana: 100,
                inventory: [],
                questProgress: ''
            },
            adventureSettings: adventure.settings as AdventureSettings,
            language: adventure.settings.language || 'en-US',
            memory: {
                recentScenes: [],
                activeQuests: [],
                knownCharacters: [],
                discoveredLocations: [],
                importantItems: []
            }
        };

        return context;
    }

    async updateSettings(
        adventureId: string,
        userId: string,
        settings: Partial<AdventureSettings>
    ): Promise<Adventure> {
        const adventure = await this.getAdventure(adventureId);
        
        if (!adventure) {
            throw new Error('Adventure not found');
        }

        if (adventure.userId !== userId) {
            throw new Error('Not authorized to update settings');
        }

        const updateAdventure = await prisma.adventure.update({
            where: { id: adventureId },
            data: {
                settings: {
                    ...adventure.settings,
                    ...settings,
                } as Prisma.InputJsonObject,
            },
            include: {
                players: {
                    include: {
                        user: true,
                        character: true,
                    },
                },
            }
        });
        return this.mapToAdventure(updateAdventure);
    }

    async getCurrentAdventure(userId: string): Promise<Adventure | null> {
        const adventure = await prisma.adventure.findFirst({
            where: {
                players: {
                    some: {
                        userId
                    }
                },
                status: 'ACTIVE'  // Only find active adventures
            },
            include: {
                players: {
                    include: {
                        user: true,
                        character: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        if(!adventure) return null;
        return this.mapToAdventure(adventure);
    }

    async buildGameContext(adventure: Adventure, description: string): Promise<GameContext> {
        const characters = await Promise.all(
            adventure.players.map(async (player) => {
                const character = await prisma.character.findUnique({
                    where: { id: player.characterId },
                    include: {
                        CharacterAbility: true,
                        CharacterSpell: true
                    }
                });
                return character;
            })
        );

        const validCharacters = characters.filter((c) => c !== null).map(this.mapToCharacter);

        return {
            adventure,
            scene: adventure.description || '',
            characters: validCharacters,
            playerActions: [description],
            currentState: {
                health: 100,
                mana: 100,
                inventory: [],
                questProgress: ''
            },
            adventureSettings: adventure.settings as AdventureSettings,
            language: (adventure.settings.language as SupportedLanguage) || 'en-US',
            memory: {
                recentScenes: [],
                activeQuests: [],
                knownCharacters: [],
                discoveredLocations: [],
                importantItems: []
            }
        };
    }

    async joinAdventure(adventureId: string, userId: string, characterName: string): Promise<Adventure> {
        const character = await prisma.character.findFirst({
            where: {
                userId,
                name: characterName
            }
        });

        if (!character) {
            throw new Error('Character not found');
        }

        const updateAdventure = await prisma.adventure.update({
            where: { id: adventureId },
            data: {
                players: {
                    create: {
                        userId,
                        characterId: character.id,
                        username: character.name
                    }
                }
            },
            include: {
                players: {
                    include: {
                        user: true,
                        character: true
                    }
                }
            }
        });
        return this.mapToAdventure(updateAdventure);
    }

    async listAdventures(userId: string): Promise<Adventure[]> {
        const adventures = await prisma.adventure.findMany({
            where: {
                players: {
                    some: {
                        userId: userId,
                    },
                },
            },
            include: {
                players: {
                    include: {
                        user: true,
                        character: true,
                    },
                },
            },
        });
        return adventures.map(adventure => this.mapToAdventure(adventure));
    }

    private mapToAdventure(adventure: any): Adventure {
        return {
            ...adventure,
            description: adventure.description || undefined,
            settings: adventure.settings as AdventureSettings,
            players: adventure.players
        }
    }

    private mapToCharacter(character: any): Character {
        return {
            ...character,
            stats: character.stats as GameStats,
            skills: character.skills as any,
            inventory: character.inventory as any[],
            effects: character.effects as any[],
            proficiencies: character.proficiencies as string[],
            languages: character.languages as string[],
            spells: character.CharacterSpell,
            abilities: character.CharacterAbility,
            background: character.background || undefined,
        };
    }
} 