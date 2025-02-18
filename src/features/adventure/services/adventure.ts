import { prisma } from '../../../core/prisma';
import { Adventure, AdventureSettings, WorldStyle, ToneStyle, MagicLevel } from '../types';
import { logger } from '../../../shared/logger';
import { Character } from '../../character/types';
import { Prisma } from '@prisma/client';
import { GameStats } from '../../../shared/game/types';
import { SupportedLanguage } from '../../../shared/i18n/types';
import { GameContext } from '../../../shared/game/types';
import { rankMemories, deduplicateMemories } from '../utils/memory';

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

        // Load and transform memories
        const memories = await prisma.memory.findMany({
            where: { adventureId: adventure.id },
            orderBy: { createdAt: 'desc' }
        });

        const transformedMemories = await this.transformMemories(memories, action);

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
            memory: transformedMemories
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

        // Load and transform memories
        const memories = await prisma.memory.findMany({
            where: { adventureId: adventure.id },
            orderBy: { createdAt: 'desc' }
        });

        const transformedMemories = await this.transformMemories(memories, description);

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
            adventureSettings: {
                worldStyle: adventure.worldStyle as WorldStyle,
                toneStyle: adventure.toneStyle as ToneStyle,
                magicLevel: adventure.magicLevel as MagicLevel,
                language: adventure.language as SupportedLanguage,
                useVoice: adventure.voiceType !== 'NONE',
                ...adventure.settings
            },
            language: adventure.language as SupportedLanguage,
            memory: transformedMemories
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
            worldStyle: adventure.worldStyle as WorldStyle,
            toneStyle: adventure.toneStyle as ToneStyle,
            magicLevel: adventure.magicLevel as MagicLevel,
        };
    }

    private mapToCharacter(character: any): Character {
        return {
            ...character,
            stats: character.stats as GameStats,
            inventory: character.inventory as string[],
            effects: character.effects as string[],
            proficiencies: character.proficiencies as string[],
            languages: character.languages as string[],
            spells: character.CharacterSpell?.map((s: any) => ({
                id: s.id,
                name: s.name,
                level: s.level,
                school: s.school,
                description: s.description,
                characterId: s.characterId
            })) || [],
            abilities: character.CharacterAbility?.map((a: any) => ({
                id: a.id,
                name: a.name,
                type: a.type,
                description: a.description,
                uses: a.uses || undefined,
                recharge: a.recharge || undefined,
                characterId: a.characterId
            })) || [],
            background: character.background || undefined
        };
    }

    private async transformMemories(memories: Memory[], currentAction: string) {
        // First rank and deduplicate memories
        const rankedMemories = rankMemories(memories, currentAction);
        const uniqueMemories = deduplicateMemories(rankedMemories);

        // Transform memories into the expected format by type
        return {
            recentScenes: uniqueMemories
                .filter(m => m.type === 'SCENE')
                .map(m => ({ summary: m.description })),
            activeQuests: uniqueMemories
                .filter(m => m.type === 'QUEST')
                .map(m => ({ title: m.title, description: m.description })),
            knownCharacters: uniqueMemories
                .filter(m => m.type === 'CHARACTER')
                .map(m => ({ title: m.title, description: m.description })),
            discoveredLocations: uniqueMemories
                .filter(m => m.type === 'LOCATION')
                .map(m => ({ title: m.title, description: m.description })),
            importantItems: uniqueMemories
                .filter(m => m.type === 'ITEM')
                .map(m => ({ title: m.title, description: m.description }))
        };
    }
} 