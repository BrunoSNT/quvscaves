import { prisma } from '../../../core/prisma';
import { logger } from '../../../shared/logger';

export interface Memory {
    id: string;
    adventureId: string;
    type: 'SCENE' | 'QUEST' | 'CHARACTER' | 'LOCATION' | 'ITEM';
    title: string;
    description: string;
    metadata?: Record<string, any>;
    createdAt: Date;
}

export class MemoryService {
    async addMemory(
        adventureId: string,
        type: Memory['type'],
        title: string,
        description: string,
        metadata?: Record<string, any>
    ): Promise<Memory> {
        try {
            const memory = await prisma.memory.create({
                data: {
                    adventureId,
                    type,
                    title,
                    description,
                    metadata
                }
            });

            logger.info(`Added ${type} memory to adventure ${adventureId}: ${title}`);
            return memory;
        } catch (error) {
            logger.error('Error adding memory:', error);
            throw error;
        }
    }

    async getMemories(
        adventureId: string,
        type?: Memory['type'],
        limit: number = 10
    ): Promise<Memory[]> {
        return prisma.memory.findMany({
            where: {
                adventureId,
                ...(type && { type })
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
    }

    async searchMemories(
        adventureId: string,
        searchTerm: string
    ): Promise<Memory[]> {
        return prisma.memory.findMany({
            where: {
                adventureId,
                OR: [
                    { title: { contains: searchTerm, mode: 'insensitive' } },
                    { description: { contains: searchTerm, mode: 'insensitive' } }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }

    async deleteMemory(memoryId: string): Promise<void> {
        await prisma.memory.delete({
            where: { id: memoryId }
        });
    }

    async updateMemory(
        memoryId: string,
        updates: Partial<Omit<Memory, 'id' | 'adventureId' | 'createdAt'>>
    ): Promise<Memory> {
        return prisma.memory.update({
            where: { id: memoryId },
            data: updates
        });
    }
} 